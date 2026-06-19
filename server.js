// ═══════════════════════════════════════════════════
// EcoIA — Proxy servidor para Claude API
// Uso: node server.js
// Luego abre: http://localhost:3000
// ═══════════════════════════════════════════════════

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT = 3000;

// MIME types para servir archivos estáticos
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  // ── CORS headers para todas las respuestas
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, anthropic-version');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── PROXY: /api/claude → api.anthropic.com/v1/messages
  if (req.method === 'POST' && req.url === '/api/claude') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch { res.writeHead(400); res.end('{"error":"JSON inválido"}'); return; }

      const apiKey = parsed._apiKey;
      delete parsed._apiKey; // No reenviar el campo interno

      if (!apiKey) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: { message: 'Falta la API Key' } }));
        return;
      }

      const payload = JSON.stringify(parsed);

      const options = {
        hostname: 'api.anthropic.com',
        path:     '/v1/messages',
        method:   'POST',
        headers: {
          'Content-Type':      'application/json',
          'Content-Length':    Buffer.byteLength(payload),
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
        }
      };

      const proxyReq = https.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.error('[Proxy Error]', err.message);
        res.writeHead(502);
        res.end(JSON.stringify({ error: { message: 'Error de conexión con Claude: ' + err.message } }));
      });

      proxyReq.write(payload);
      proxyReq.end();
    });
    return;
  }

  // ── ARCHIVOS ESTÁTICOS: servir HTML, CSS, JS
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath.split('?')[0]);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Archivo no encontrado: ' + req.url);
      return;
    }
    const ext  = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  🌿  EcoIA — Servidor corriendo');
  console.log(`  👉  Abre: http://localhost:${PORT}`);
  console.log('');
  console.log('  Presiona Ctrl+C para detener');
  console.log('');
});