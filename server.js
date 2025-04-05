// server.js
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

let botProcess = null;

app.use(express.static(path.join(__dirname, 'index.html')));
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Bot
app.get('/start-bot', (req, res) => {
  if (!botProcess) {
    const botPath = path.join(__dirname, 'bot.js');
    botProcess = spawn('node', [botPath], {
      stdio: 'inherit'
    });
    return res.json({ message: 'Bot WhatsApp sudah dijalankan.' });
  }
  res.json({ message: 'Bot sudah berjalan.' });
});

// Stop Bot
app.get('/stop-bot', (req, res) => {
  if (botProcess) {
    botProcess.kill();
    botProcess = null;
    return res.json({ message: 'Bot WhatsApp telah dihentikan.' });
  }
  res.json({ message: 'Bot tidak sedang berjalan.' });
});

// Status Bot
app.get('/status', (req, res) => {
  const status = botProcess ? 'running' : 'stopped';
  res.json({ status });
});

// Kirim Pesan (opsional, nanti diintegrasi)
app.post('/send', (req, res) => {
  const { number, message } = req.body;
  // Integrasi pengiriman pesan menyusul
  res.json({ message: 'Fitur kirim pesan belum diimplementasi.' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server API aktif di http://localhost:${PORT}`);
});
