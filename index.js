const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const PORT = process.env.PORT || 80;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function proxySender(ws, conn) {
  ws.on('message', (cmd) => {
    try {
      const command = JSON.parse(cmd);
      const method = command.method;
      if (method === 'mining.subscribe' || method === 'mining.authorize' || method === 'mining.submit') {
        conn.write(cmd);
      }
    } catch (error) {
      ws.close();
    }
  });

  ws.on('close', () => {
    console.log('[Proxy] Connection to mining pool is closed!');
    conn.end();
  });
}

function proxyReceiver(conn, cmdq) {
  conn.on('data', (data) => {
    cmdq.send(data.toString());
  });
  conn.on('error', (err) => {
    console.log(`[err.code] Error: ${err.message}`);
    conn.end();
  });
  conn.on('end', () => {
    cmdq.close();
  });
}

function proxyConnect(host, port) {
  const conn = net.createConnection(port, host, () => {
    console.log('[Proxy] Connected to mining pool!');
  });
  return conn;
}

function proxyMain(ws, req) {
  ws.on('message', (message) => {
    const command = JSON.parse(message);
    if (command.method === 'proxy.connect' && command.params.length === 2) {
      const host = command.params[0];
      const port = command.params[1];
      const conn = proxyConnect(host, port);
      if (conn) {
        proxySender(ws, conn, []);
        proxyReceiver(conn, ws);
      }
    }
  });
}

wss.on('connection', proxyMain);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
