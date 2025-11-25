const express = require('express');
const bodyParser = require('body-parser');
const { Client, LocalAuth } = require('whatsapp-web.js');
const cron = require('node-cron');
const QRCode = require('qrcode');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Database setup
const db = new Database('scheduler.db');
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

// WhatsApp client setup
let client = null;
let qrCodeData = null;
let isReady = false;
let chatsCache = null;
let lastCacheUpdate = null;

function initializeWhatsAppClient() {
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    }
  });

  client.on('qr', (qr) => {
    console.log('📱 QR Code received, generating image...');
    qrCodeData = qr;
    QRCode.toDataURL(qr, (err, url) => {
      if (!err) qrCodeData = url;
    });
  });

  client.on('ready', async () => {
    console.log('✓ WhatsApp Client is ready!');
    isReady = true;
    qrCodeData = null;
    
    // Wait a bit then preload chats
    setTimeout(async () => {
      try {
        console.log('⏳ Preloading chats...');
        await loadChatsCache();
        console.log(`✓ Successfully loaded ${chatsCache ? chatsCache.length : 0} chats (contacts + groups)`);
      } catch (error) {
        console.error('✗ Error preloading chats:', error.message);
      }
    }, 3000);
  });

  client.on('authenticated', () => {
    console.log('✓ WhatsApp authenticated successfully');
  });

  client.on('auth_failure', () => {
    console.error('✗ WhatsApp authentication failed');
    isReady = false;
  });

  client.on('disconnected', (reason) => {
    console.log('⚠ WhatsApp disconnected:', reason);
    isReady = false;
    chatsCache = null;
  });

  client.initialize();
}

// Load and cache chats
async function loadChatsCache() {
  try {
    const now = Date.now();
    // Cache for 30 seconds to avoid hammering WhatsApp
    if (chatsCache && lastCacheUpdate && (now - lastCacheUpdate) < 30000) {
      console.log('📋 Using cached chats');
      return chatsCache;
    }
    
    console.log('🔍 Fetching chats from WhatsApp...');
    const allChats = await client.getChats();
    console.log(`📊 Found ${allChats.length} total chats`);
    
    const processed = [];
    let groupCount = 0;
    let contactCount = 0;
    let skippedCount = 0;
    
    for (const chat of allChats) {
      try {
        if (chat.isGroup) {
          // It's a group - use chat properties directly
          processed.push({
            id: chat.id._serialized,
            name: `📁 ${chat.name || 'Unnamed Group'}`,
            number: null,
            isGroup: true
          });
          groupCount++;
          console.log(`  ✓ Group: ${chat.name || 'Unnamed'}`);
        } else if (!chat.isMe) {
          // Regular contact - use chat properties without calling getContact()
          const contactName = chat.name || chat.id.user || 'Unknown';
          processed.push({
            id: chat.id._serialized,
            name: contactName,
            number: chat.id.user, // phone number
            isGroup: false
          });
          contactCount++;
          console.log(`  ✓ Contact: ${contactName}`);
        } else {
          skippedCount++;
        }
      } catch (err) {
        console.error(`  ✗ Error processing chat:`, err.message);
        skippedCount++;
      }
    }
    
    console.log(`📈 Processing complete: ${groupCount} groups, ${contactCount} contacts, ${skippedCount} skipped`);
    
    chatsCache = processed.sort((a, b) => {
      // Groups first, then by name
      if (a.isGroup && !b.isGroup) return -1;
      if (!a.isGroup && b.isGroup) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
    
    lastCacheUpdate = now;
    return chatsCache;
  } catch (error) {
    console.error('✗ Error loading chats cache:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
}

// Calculate realistic typing delay based on message length
// Average mobile typing: ~3 chars/second, with variation
function calculateTypingDelay(messageLength) {
  const baseCharsPerSecond = 3; // Conservative typing speed
  const variance = 0.5; // Add randomness
  
  const charsPerSecond = baseCharsPerSecond + (Math.random() * variance * 2 - variance);
  const baseDelay = (messageLength / charsPerSecond) * 1000; // ms
  
  // Add thinking time between messages (1-3 seconds)
  const thinkingTime = 1000 + Math.random() * 2000;
  
  return Math.floor(baseDelay + thinkingTime);
}

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

// API Routes
app.get('/api/status', (req, res) => {
  res.json({
    isReady,
    hasQR: !!qrCodeData,
    qrCode: isReady ? null : qrCodeData
  });
});

// Get contacts and groups
app.get('/api/contacts', async (req, res) => {
  if (!isReady) {
    console.log('⚠ API /contacts called but WhatsApp not ready');
    return res.status(503).json({ error: 'WhatsApp client not ready' });
  }
  
  try {
    console.log('📞 API: Loading contacts for frontend...');
    const chats = await loadChatsCache();
    console.log(`✓ Returning ${chats ? chats.length : 0} chats to frontend`);
    res.json(chats || []);
  } catch (error) {
    console.error('✗ API /contacts error:', error.message);
    res.json([]); // Return empty array on error - user can type number manually
  }
});

app.post('/api/schedule', (req, res) => {
  const { phoneNumber, message, scheduledTime } = req.body;
  
  console.log(`📝 Schedule request: ${phoneNumber}, ${message.length} chars, at ${scheduledTime}`);
  
  if (!phoneNumber || !message || !scheduledTime) {
    console.log('✗ Missing required fields');
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const scheduledDate = new Date(scheduledTime);
  if (scheduledDate <= new Date()) {
    console.log('✗ Scheduled time is in the past');
    return res.status(400).json({ error: 'Scheduled time must be in the future' });
  }

  try {
    // Split messages by "/" delimiter
    const messages = message.split('/').map(m => m.trim()).filter(m => m.length > 0);
    
    if (messages.length === 0) {
      console.log('✗ No valid messages after splitting');
      return res.status(400).json({ error: 'No valid messages found' });
    }

    console.log(`📨 Splitting into ${messages.length} messages`);

    const batchId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    let cumulativeDelay = 0;
    const insertedIds = [];

    // Create scheduled entry for each message with realistic delays
    messages.forEach((msg, index) => {
      const msgScheduledTime = new Date(scheduledDate.getTime() + cumulativeDelay);
      
      const stmt = db.prepare(
        'INSERT INTO scheduled_messages (phone_number, message, scheduled_time, batch_id) VALUES (?, ?, ?, ?)'
      );
      const result = stmt.run(phoneNumber, msg, msgScheduledTime.toISOString(), batchId);
      insertedIds.push(result.lastInsertRowid);
      
      const delaySeconds = Math.floor(cumulativeDelay / 1000);
      console.log(`  ${index + 1}. "${msg.substring(0, 30)}..." at +${delaySeconds}s`);
      
      // Calculate delay for next message based on current message length
      if (index < messages.length - 1) {
        cumulativeDelay += calculateTypingDelay(msg.length);
      }
    });
    
    console.log(`✓ Scheduled ${messages.length} messages with batch ID: ${batchId}`);
    
    res.json({
      success: true,
      count: messages.length,
      ids: insertedIds,
      message: `${messages.length} message(s) scheduled with realistic delays`
    });
  } catch (error) {
    console.error('✗ Error scheduling messages:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/scheduled', (req, res) => {
  try {
    const stmt = db.prepare(
      'SELECT * FROM scheduled_messages WHERE sent = 0 ORDER BY scheduled_time ASC'
    );
    const messages = stmt.all();
    res.json(messages);
  } catch (error) {
    console.error('✗ Error fetching scheduled messages:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/scheduled/:id', (req, res) => {
  try {
    console.log(`🗑 Deleting message ID: ${req.params.id}`);
    const stmt = db.prepare('DELETE FROM scheduled_messages WHERE id = ? AND sent = 0');
    const result = stmt.run(req.params.id);
    
    if (result.changes > 0) {
      console.log(`✓ Deleted message ${req.params.id}`);
      res.json({ success: true, message: 'Message deleted' });
    } else {
      console.log(`⚠ Message ${req.params.id} not found or already sent`);
      res.status(404).json({ error: 'Message not found' });
    }
  } catch (error) {
    console.error('✗ Error deleting message:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/scheduled/batch/:batchId', (req, res) => {
  try {
    console.log(`🗑 Deleting batch: ${req.params.batchId}`);
    const stmt = db.prepare('DELETE FROM scheduled_messages WHERE batch_id = ? AND sent = 0');
    const result = stmt.run(req.params.batchId);
    
    console.log(`✓ Deleted ${result.changes} messages from batch`);
    res.json({ 
      success: true, 
      message: `Deleted ${result.changes} message(s) from batch` 
    });
  } catch (error) {
    console.error('✗ Error deleting batch:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cron job to check and send scheduled messages every minute
cron.schedule('* * * * *', async () => {
  if (!isReady) return;

  const now = new Date();
  const stmt = db.prepare(
    'SELECT * FROM scheduled_messages WHERE sent = 0 AND datetime(scheduled_time) <= datetime(?)'
  );
  const messagesToSend = stmt.all(now.toISOString());

  if (messagesToSend.length > 0) {
    console.log(`📤 Found ${messagesToSend.length} message(s) to send`);
  }

  for (const msg of messagesToSend) {
    try {
      // Phone number is already in correct format from contacts selector
      // Groups: xxxxx@g.us, Contacts: xxxxx@c.us
      let chatId = msg.phone_number;
      
      // If manually entered, format it
      if (!chatId.includes('@')) {
        chatId = chatId.replace(/[^0-9]/g, '') + '@c.us';
      }

      console.log(`  ⏳ Sending message ${msg.id} to ${chatId}...`);
      await client.sendMessage(chatId, msg.message);
      
      // Mark as sent
      const updateStmt = db.prepare('UPDATE scheduled_messages SET sent = 1 WHERE id = ?');
      updateStmt.run(msg.id);
      
      console.log(`  ✓ Sent message ${msg.id}: "${msg.message.substring(0, 40)}..."`);
      
      // Small random delay to avoid detection
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
    } catch (error) {
      console.error(`  ✗ Failed to send message ${msg.id}:`, error.message);
    }
  }
});

// Start server and WhatsApp client
app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📱 WhatsApp Message Scheduler');
  console.log(`🌐 Server running on http://localhost:${PORT}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  initializeWhatsAppClient();
});
