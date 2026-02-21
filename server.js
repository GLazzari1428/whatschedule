const express = require('express');
const bodyParser = require('body-parser');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const cron = require('node-cron');
const QRCode = require('qrcode');
const Database = require('better-sqlite3');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const APP_PASSWORD  = process.env.APP_PASSWORD  || '';
// AUTH_ENABLED defaults to true when a password is set, false otherwise.
// Set AUTH_ENABLED=false to disable auth even if APP_PASSWORD is defined.
// Set AUTH_ENABLED=true  to require auth (APP_PASSWORD must also be set).
const AUTH_ENABLED  = (() => {
  const raw = process.env.AUTH_ENABLED;
  if (raw === undefined || raw === '') return !!APP_PASSWORD; // backwards-compat default
  return raw.toLowerCase() !== 'false' && raw !== '0';
})();

// Ensure directories exist
[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Database Setup ───────────────────────────────────────────────────────────
const dbPath = path.join(DATA_DIR, 'scheduler.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_number TEXT NOT NULL,
    contact_name TEXT,
    message TEXT NOT NULL,
    scheduled_time TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    sent BOOLEAN DEFAULT 0,
    batch_id TEXT,
    file_path TEXT,
    file_name TEXT,
    file_mimetype TEXT
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

// Migrations for existing databases
const migrations = [
  'ALTER TABLE scheduled_messages ADD COLUMN contact_name TEXT',
  'ALTER TABLE scheduled_messages ADD COLUMN file_path TEXT',
  'ALTER TABLE scheduled_messages ADD COLUMN file_name TEXT',
  'ALTER TABLE scheduled_messages ADD COLUMN file_mimetype TEXT',
];
migrations.forEach(sql => { try { db.exec(sql); } catch (e) { /* already exists */ } });

// ─── Auth ─────────────────────────────────────────────────────────────────────
const authSessions = new Map(); // token -> expiry

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();
  const token = req.headers['x-auth-token'];
  const expiry = authSessions.get(token);
  if (expiry && expiry > Date.now()) {
    authSessions.set(token, Date.now() + 24 * 60 * 60 * 1000);
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// ─── File Helper ──────────────────────────────────────────────────────────────
function saveUploadedFile(base64Data, fileName) {
  const ext = path.extname(fileName) || '.bin';
  const uniqueName = Date.now() + '_' + crypto.randomBytes(8).toString('hex') + ext;
  const filePath = path.join(UPLOADS_DIR, uniqueName);
  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
  return filePath;
}

// ─── WhatsApp State ───────────────────────────────────────────────────────────
let client = null;
let qrCodeData = null;
let isReady = false;
let chatsCache = null;
let lastCacheUpdate = null;

// ─── WebSocket Helpers ────────────────────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch (e) {}
    }
  });
}

// THE KEY BUG FIX: send current state to any newly connected WS client
// Previously, if WS reconnected AFTER the 'ready' event fired, the client
// would never learn that WhatsApp is connected.
function sendCurrentState(ws) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    if (isReady) {
      ws.send(JSON.stringify({ type: 'ready' }));
      if (chatsCache) {
        ws.send(JSON.stringify({ type: 'contacts', data: chatsCache }));
      }
      const favs = db.prepare('SELECT * FROM favorites ORDER BY added_at DESC').all();
      ws.send(JSON.stringify({ type: 'favorites', data: favs }));
      const scheduled = db.prepare(
        'SELECT * FROM scheduled_messages WHERE sent = 0 ORDER BY scheduled_time ASC'
      ).all();
      ws.send(JSON.stringify({ type: 'scheduled', data: scheduled }));
    } else if (qrCodeData) {
      ws.send(JSON.stringify({ type: 'qr', data: qrCodeData }));
    }
  } catch (e) {}
}

wss.on('connection', (ws) => {
  sendCurrentState(ws); // ← This fixes the QR-scan-but-page-doesn't-update bug
  ws.on('error', err => console.error('WS error:', err.message));
});

// ─── WhatsApp Client ──────────────────────────────────────────────────────────
function initializeWhatsAppClient() {
  const clientOptions = {
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu'
      ]
    }
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    clientOptions.puppeteer.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  client = new Client(clientOptions);

  client.on('qr', (qr) => {
    console.log('QR Code received');
    QRCode.toDataURL(qr, (err, url) => {
      if (!err) {
        qrCodeData = url;
        broadcast({ type: 'qr', data: url });
      }
    });
  });

  client.on('ready', async () => {
    console.log('WhatsApp Client is ready!');
    isReady = true;
    qrCodeData = null;
    broadcast({ type: 'ready' });

    setTimeout(async () => {
      try {
        console.log('Preloading chats...');
        await loadChatsCache();
        console.log(`Loaded ${chatsCache ? chatsCache.length : 0} chats`);
        broadcast({ type: 'contacts', data: chatsCache });
      } catch (error) {
        console.error('Error preloading chats:', error.message);
      }
    }, 3000);
  });

  client.on('authenticated', () => console.log('WhatsApp authenticated'));

  client.on('auth_failure', (msg) => {
    console.error('Auth failed:', msg);
    isReady = false;
  });

  client.on('disconnected', (reason) => {
    console.log('WhatsApp disconnected:', reason);
    isReady = false;
    chatsCache = null;
    broadcast({ type: 'disconnected' });
  });

  client.initialize().catch(err => {
    console.error('Failed to initialize WhatsApp client:', err);
    process.exit(1);
  });
}

async function loadChatsCache(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && chatsCache && lastCacheUpdate && (now - lastCacheUpdate) < 30000) {
    return chatsCache;
  }

  const allChats = await client.getChats();
  const processed = [];

  for (let i = 0; i < allChats.length; i++) {
    const chat = allChats[i];
    try {
      if (chat.isGroup) {
        processed.push({ id: chat.id._serialized, name: chat.name || 'Unnamed Group', number: null, isGroup: true });
      } else if (!chat.isMe) {
        processed.push({ id: chat.id._serialized, name: chat.name || chat.id.user || 'Unknown', number: chat.id.user, isGroup: false });
      }

      if ((i + 1) % 10 === 0 || (i + 1) === allChats.length) {
        broadcast({ type: 'contacts_progress', data: { current: i + 1, total: allChats.length } });
      }
    } catch (err) {
      console.error('Error processing chat:', err.message);
    }
  }

  chatsCache = processed.sort((a, b) => {
    if (a.isGroup && !b.isGroup) return -1;
    if (!a.isGroup && b.isGroup) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  lastCacheUpdate = now;
  return chatsCache;
}

function calculateTypingDelay(messageLength) {
  const charsPerSecond = 3 + (Math.random() - 0.5);
  return Math.floor((messageLength / charsPerSecond) * 1000 + 1000 + Math.random() * 2000);
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(bodyParser.json({ limit: '25mb' })); // 25MB for file uploads
app.use(express.static('public'));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With, x-auth-token');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.get('/api/auth/check', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ required: false, valid: true });
  const token = req.headers['x-auth-token'];
  const expiry = authSessions.get(token);
  res.json({ required: true, valid: !!(expiry && expiry > Date.now()) });
});

app.post('/api/auth/login', (req, res) => {
  if (!AUTH_ENABLED) {
    // Auth is off — issue a dummy token so the client flow still works
    const token = generateToken();
    authSessions.set(token, Date.now() + 24 * 60 * 60 * 1000);
    return res.json({ success: true, token });
  }
  const { password } = req.body;
  if (password === APP_PASSWORD) {
    const token = generateToken();
    authSessions.set(token, Date.now() + 24 * 60 * 60 * 1000);
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.headers['x-auth-token'];
  authSessions.delete(token);
  res.json({ success: true });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({ isReady, hasQR: !!qrCodeData, qrCode: isReady ? null : qrCodeData });
});

app.get('/api/contacts', requireAuth, async (req, res) => {
  if (!isReady) return res.status(503).json({ error: 'WhatsApp not ready' });
  try {
    const chats = await loadChatsCache(req.query.refresh === 'true');
    res.json(chats || []);
  } catch (e) {
    res.json([]);
  }
});

app.get('/api/favorites', requireAuth, (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM favorites ORDER BY added_at DESC').all());
  } catch (e) {
    res.json([]);
  }
});

app.post('/api/favorites', requireAuth, (req, res) => {
  try {
    const { chatId, name, isGroup } = req.body;
    db.prepare('INSERT OR REPLACE INTO favorites (chat_id, name, is_group) VALUES (?, ?, ?)').run(chatId, name, isGroup ? 1 : 0);
    const all = db.prepare('SELECT * FROM favorites ORDER BY added_at DESC').all();
    broadcast({ type: 'favorites', data: all });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/favorites/:chatId', requireAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM favorites WHERE chat_id = ?').run(req.params.chatId);
    const all = db.prepare('SELECT * FROM favorites ORDER BY added_at DESC').all();
    broadcast({ type: 'favorites', data: all });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/schedule', requireAuth, (req, res) => {
  const { phoneNumber, contactName, messages, scheduledTime, fileData, fileName, fileMimeType } = req.body;

  if (!phoneNumber || !messages || messages.length === 0 || !scheduledTime) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const scheduledDate = new Date(scheduledTime);
  if (scheduledDate <= new Date()) {
    return res.status(400).json({ error: 'Scheduled time must be in the future' });
  }

  try {
    // Save file to disk if provided
    let savedFilePath = null;
    if (fileData && fileName) {
      savedFilePath = saveUploadedFile(fileData, fileName);
    }

    const batchId = Date.now().toString() + crypto.randomBytes(4).toString('hex');
    let cumulativeDelay = 0;
    const ids = [];

    const stmt = db.prepare(
      `INSERT INTO scheduled_messages
        (phone_number, contact_name, message, scheduled_time, batch_id, file_path, file_name, file_mimetype)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    messages.forEach((msg, index) => {
      const msgTime = new Date(scheduledDate.getTime() + cumulativeDelay).toISOString();
      // Only attach file to first message
      const fp = index === 0 ? savedFilePath : null;
      const fn = index === 0 ? (fileName || null) : null;
      const fm = index === 0 ? (fileMimeType || null) : null;

      const result = stmt.run(phoneNumber, contactName || null, msg, msgTime, batchId, fp, fn, fm);
      ids.push(result.lastInsertRowid);

      if (index < messages.length - 1) {
        cumulativeDelay += calculateTypingDelay(msg.length);
      }
    });

    const all = db.prepare('SELECT * FROM scheduled_messages WHERE sent = 0 ORDER BY scheduled_time ASC').all();
    broadcast({ type: 'scheduled', data: all });

    res.json({ success: true, count: messages.length, ids });
  } catch (e) {
    console.error('Schedule error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/scheduled', requireAuth, (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM scheduled_messages WHERE sent = 0 ORDER BY scheduled_time ASC').all());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Edit scheduled message (time and/or content)
app.put('/api/scheduled/:id', requireAuth, (req, res) => {
  try {
    const { scheduledTime, message } = req.body;
    const updates = [];
    const params = [];

    if (scheduledTime) { updates.push('scheduled_time = ?'); params.push(scheduledTime); }
    if (message !== undefined) { updates.push('message = ?'); params.push(message); }

    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    params.push(req.params.id);
    const result = db.prepare(
      `UPDATE scheduled_messages SET ${updates.join(', ')} WHERE id = ? AND sent = 0`
    ).run(...params);

    if (result.changes > 0) {
      const all = db.prepare('SELECT * FROM scheduled_messages WHERE sent = 0 ORDER BY scheduled_time ASC').all();
      broadcast({ type: 'scheduled', data: all });
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Message not found' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/scheduled/:id', requireAuth, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM scheduled_messages WHERE id = ? AND sent = 0').run(req.params.id);
    if (result.changes > 0) {
      const all = db.prepare('SELECT * FROM scheduled_messages WHERE sent = 0 ORDER BY scheduled_time ASC').all();
      broadcast({ type: 'scheduled', data: all });
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Message not found' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/scheduled/batch/:batchId', requireAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM scheduled_messages WHERE batch_id = ? AND sent = 0').run(req.params.batchId);
    const all = db.prepare('SELECT * FROM scheduled_messages WHERE sent = 0 ORDER BY scheduled_time ASC').all();
    broadcast({ type: 'scheduled', data: all });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Cron: Send Messages ──────────────────────────────────────────────────────
cron.schedule('*/5 * * * * *', async () => {
  if (!isReady) return;

  const msgs = db.prepare(
    'SELECT * FROM scheduled_messages WHERE sent = 0 AND datetime(scheduled_time) <= datetime(?)'
  ).all(new Date().toISOString());

  for (const msg of msgs) {
    try {
      let chatId = msg.phone_number;
      if (!chatId.includes('@')) chatId = chatId.replace(/[^0-9]/g, '') + '@c.us';

      if (msg.file_path && fs.existsSync(msg.file_path)) {
        const media = MessageMedia.fromFilePath(msg.file_path);
        await client.sendMessage(chatId, media, { caption: msg.message || undefined });
      } else {
        await client.sendMessage(chatId, msg.message);
      }

      db.prepare('UPDATE scheduled_messages SET sent = 1 WHERE id = ?').run(msg.id);
      console.log(`Sent message ${msg.id} to ${chatId}`);

      const all = db.prepare('SELECT * FROM scheduled_messages WHERE sent = 0 ORDER BY scheduled_time ASC').all();
      broadcast({ type: 'scheduled', data: all });

      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error(`Failed to send message ${msg.id}:`, e.message);
    }
  }
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
['SIGTERM', 'SIGINT'].forEach(signal => {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down...`);
    server.close(() => {
      if (client) client.destroy();
      db.close();
      process.exit(0);
    });
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  let ip = '0.0.0.0';
  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) { ip = net.address; break; }
    }
    if (ip !== '0.0.0.0') break;
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('WhatsScheduler');
  console.log(`Server: http://${ip}:${PORT}`);
  console.log(`Data: ${DATA_DIR}`);
  console.log(`Auth: ${AUTH_ENABLED ? `Enabled (password ${APP_PASSWORD ? 'set' : '⚠ NOT SET — any password accepted'})` : 'Disabled'}`);
  console.log(`Docker: ${process.env.PUPPETEER_EXECUTABLE_PATH ? 'Yes' : 'No'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  initializeWhatsAppClient();
});
