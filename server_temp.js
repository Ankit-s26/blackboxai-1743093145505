const express = require('express');
const path = require('path');
const WebSocket = require('ws');
const net = require('net');

const app = express();
const wss = new WebSocket.Server({ noServer: true });

// Track connected responders
const responders = new Set();

wss.on('connection', (ws) => {
  responders.add(ws);
  ws.on('close', () => responders.delete(ws));
});

// Find available port (8000-9000)
async function findAvailablePort() {
  for (let port = 8000; port <= 9000; port++) {
    const available = await new Promise(resolve => {
      const tester = net.createServer()
        .once('error', () => resolve(false))
        .once('listening', () => {
          tester.close();
          resolve(true);
        })
        .listen(port);
    });
    if (available) return port;
  }
  throw new Error('No available ports found');
}

// Start server
async function startServer() {
  const port = await findAvailablePort();
  const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Open http://localhost:${port} in your browser`);
  });

  // Setup WebSocket upgrade handler
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  return server;
}

// Serve static files
app.use(express.static(path.join(__dirname, '/')));

// Start the server
startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});