const express = require('express');
const bodyParser = require('body-parser');
const { Client, LocalAuth } = require('whatsapp-web.js');
const cron = require('node-cron');
const QRCode = require('qrcode');
const Database = require('better-sqlite3');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Database setup
const dbPath = path.join(DATA_DIR, 'scheduler.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_number TEXT NOT NULL,
    message TEXT NOT NULL,
    scheduled_time TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    sent BOOLEAN DEFAULT 0,
    batch_id TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    is_group BOOLEAN DEFAULT 0,
    added_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// WhatsApp client setup
let client = null;
let qrCodeData = null;
let isReady = false;
let chatsCache = null;
let lastCacheUpdate = null;

// WebSocket broadcast
function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(data));
      } catch (error) {
        console.error('WebSocket broadcast error:', error.message);
      }
    }
  });
}

function initializeWhatsAppClient() {
  const clientOptions = {
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    }
  };

  // Use system Chromium in Docker
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    clientOptions.puppeteer.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  client = new Client(clientOptions);

  client.on('qr', (qr) => {
    console.log('📱 QR Code received');
    qrCodeData = qr;
    QRCode.toDataURL(qr, (err, url) => {
      if (!err) {
        qrCodeData = url;
        broadcast({ type: 'qr', data: url });
      }
    });
  });

  client.on('ready', async () => {
    console.log('✓ WhatsApp Client is ready!');
    isReady = true;
    qrCodeData = null;
    broadcast({ type: 'ready' });
    
    setTimeout(async () => {
      try {
        console.log('⏳ Preloading chats...');
        await loadChatsCache();
        console.log(`✓ Successfully loaded ${chatsCache ? chatsCache.length : 0} chats`);
        broadcast({ type: 'contacts', data: chatsCache });
      } catch (error) {
        console.error('✗ Error preloading chats:', error.message);
      }
    }, 3000);
  });

  client.on('authenticated', () => {
    console.log('✓ WhatsApp authenticated');
  });

  client.on('auth_failure', (msg) => {
    console.error('✗ WhatsApp authentication failed:', msg);
    isReady = false;
  });

  client.on('disconnected', (reason) => {
    console.log('⚠ WhatsApp disconnected:', reason);
    isReady = false;
    chatsCache = null;
    broadcast({ type: 'disconnected' });
  });

  client.initialize().catch(err => {
    console.error('Failed to initialize WhatsApp client:', err);
    process.exit(1);
  });
}

async function loadChatsCache() {
  try {
    const now = Date.now();
    if (chatsCache && lastCacheUpdate && (now - lastCacheUpdate) < 30000) {
      return chatsCache;
    }
    
    const allChats = await client.getChats();
    const processed = [];
    
    for (const chat of allChats) {
      try {
        if (chat.isGroup) {
          processed.push({
            id: chat.id._serialized,
            name: chat.name || 'Unnamed Group',
            number: null,
            isGroup: true
          });
        } else if (!chat.isMe) {
          const contactName = chat.name || chat.id.user || 'Unknown';
          processed.push({
            id: chat.id._serialized,
            name: contactName,
            number: chat.id.user,
            isGroup: false
          });
        }
      } catch (err) {
        console.error(`Error processing chat:`, err.message);
      }
    }
    
    chatsCache = processed.sort((a, b) => {
      if (a.isGroup && !b.isGroup) return -1;
      if (!a.isGroup && b.isGroup) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
    
    lastCacheUpdate = now;
    return chatsCache;
  } catch (error) {
    console.error('✗ Error loading chats cache:', error.message);
    throw error;
  }
}

function calculateTypingDelay(messageLength) {
  const baseCharsPerSecond = 3;
  const variance = 0.5;
  const charsPerSecond = baseCharsPerSecond + (Math.random() * variance * 2 - variance);
  const baseDelay = (messageLength / charsPerSecond) * 1000;
  const thinkingTime = 1000 + Math.random() * 2000;
  return Math.floor(baseDelay + thinkingTime);
}

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Express error:', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// API Routes
app.get('/api/status', (req, res) => {
  res.json({
    isReady,
    hasQR: !!qrCodeData,
    qrCode: isReady ? null : qrCodeData
  });
});

app.get('/api/contacts', async (req, res) => {
  if (!isReady) {
    return res.status(503).json({ error: 'WhatsApp client not ready' });
  }
  
  try {
    const chats = await loadChatsCache();
    res.json(chats || []);
  } catch (error) {
    res.json([]);
  }
});

app.get('/api/favorites', (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM favorites ORDER BY added_at DESC');
    const favorites = stmt.all();
    res.json(favorites);
  } catch (error) {
    res.json([]);
  }
});

app.post('/api/favorites', (req, res) => {
  try {
    const { chatId, name, isGroup } = req.body;
    const stmt = db.prepare('INSERT OR REPLACE INTO favorites (chat_id, name, is_group) VALUES (?, ?, ?)');
    stmt.run(chatId, name, isGroup ? 1 : 0);
    
    const allFavorites = db.prepare('SELECT * FROM favorites ORDER BY added_at DESC').all();
    broadcast({ type: 'favorites', data: allFavorites });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/favorites/:chatId', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM favorites WHERE chat_id = ?');
    stmt.run(req.params.chatId);
    
    const allFavorites = db.prepare('SELECT * FROM favorites ORDER BY added_at DESC').all();
    broadcast({ type: 'favorites', data: allFavorites });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/schedule', (req, res) => {
  const { phoneNumber, messages, scheduledTime } = req.body;
  
  if (!phoneNumber || !messages || messages.length === 0 || !scheduledTime) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const scheduledDate = new Date(scheduledTime);
  if (scheduledDate <= new Date()) {
    return res.status(400).json({ error: 'Scheduled time must be in the future' });
  }

  try {
    const batchId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    let cumulativeDelay = 0;
    const insertedIds = [];

    messages.forEach((msg, index) => {
      const msgScheduledTime = new Date(scheduledDate.getTime() + cumulativeDelay);
      
      const stmt = db.prepare(
        'INSERT INTO scheduled_messages (phone_number, message, scheduled_time, batch_id) VALUES (?, ?, ?, ?)'
      );
      const result = stmt.run(phoneNumber, msg, msgScheduledTime.toISOString(), batchId);
      insertedIds.push(result.lastInsertRowid);
      
      if (index < messages.length - 1) {
        cumulativeDelay += calculateTypingDelay(msg.length);
      }
    });
    
    console.log(`✓ Scheduled ${messages.length} messages`);
    
    const allScheduled = db.prepare('SELECT * FROM scheduled_messages WHERE sent = 0 ORDER BY scheduled_time ASC').all();
    broadcast({ type: 'scheduled', data: allScheduled });
    
    res.json({
      success: true,
      count: messages.length,
      ids: insertedIds
    });
  } catch (error) {
    console.error('✗ Error scheduling:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/scheduled', (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM scheduled_messages WHERE sent = 0 ORDER BY scheduled_time ASC');
    const messages = stmt.all();
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/scheduled/:id', (req, res) => {
  try {
    const { scheduledTime } = req.body;
    const stmt = db.prepare('UPDATE scheduled_messages SET scheduled_time = ? WHERE id = ? AND sent = 0');
    const result = stmt.run(scheduledTime, req.params.id);
    
    if (result.changes > 0) {
      const allScheduled = db.prepare('SELECT * FROM scheduled_messages WHERE sent = 0 ORDER BY scheduled_time ASC').all();
      broadcast({ type: 'scheduled', data: allScheduled });
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Message not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/scheduled/:id', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM scheduled_messages WHERE id = ? AND sent = 0');
    const result = stmt.run(req.params.id);
    
    if (result.changes > 0) {
      const allScheduled = db.prepare('SELECT * FROM scheduled_messages WHERE sent = 0 ORDER BY scheduled_time ASC').all();
      broadcast({ type: 'scheduled', data: allScheduled });
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Message not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/scheduled/batch/:batchId', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM scheduled_messages WHERE batch_id = ? AND sent = 0');
    stmt.run(req.params.batchId);
    
    const allScheduled = db.prepare('SELECT * FROM scheduled_messages WHERE sent = 0 ORDER BY scheduled_time ASC').all();
    broadcast({ type: 'scheduled', data: allScheduled });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cron job - every 5 seconds for precise timing
cron.schedule('*/5 * * * * *', async () => {
  if (!isReady) return;

  const now = new Date();
  const stmt = db.prepare('SELECT * FROM scheduled_messages WHERE sent = 0 AND datetime(scheduled_time) <= datetime(?)');
  const messagesToSend = stmt.all(now.toISOString());

  for (const msg of messagesToSend) {
    try {
      let chatId = msg.phone_number;
      if (!chatId.includes('@')) {
        chatId = chatId.replace(/[^0-9]/g, '') + '@c.us';
      }

      await client.sendMessage(chatId, msg.message);
      
      const updateStmt = db.prepare('UPDATE scheduled_messages SET sent = 1 WHERE id = ?');
      updateStmt.run(msg.id);
      
      console.log(`✓ Sent message ${msg.id}`);
      
      const allScheduled = db.prepare('SELECT * FROM scheduled_messages WHERE sent = 0 ORDER BY scheduled_time ASC').all();
      broadcast({ type: 'scheduled', data: allScheduled });
      
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`✗ Failed to send message ${msg.id}:`, error.message);
    }
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing gracefully...');
  server.close(() => {
    if (client) client.destroy();
    db.close();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing gracefully...');
  server.close(() => {
    if (client) client.destroy();
    db.close();
    process.exit(0);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📱 WhatsApp Message Scheduler');
  console.log(`🌐 Server: http://0.0.0.0:${PORT}`);
  console.log(`📂 Data: ${DATA_DIR}`);
  console.log(`🐳 Docker: ${process.env.PUPPETEER_EXECUTABLE_PATH ? 'Yes' : 'No'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  initializeWhatsAppClient();
});
