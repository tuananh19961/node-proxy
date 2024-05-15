const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const PORT = process.env.PORT || 8088;
const { writeFileSync, readFileSync, existsSync } = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const nodes = {};
const MAX_CONNECTION_PER_IP = 10;
const BLACK_LIST_FILE = './blacklists.json';

const addToBlackList = (ip) => {
  let data = require(BLACK_LIST_FILE) || [];
  data = [...data, ip];
  try {
    writeFileSync(BLACK_LIST_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.log('An error has occurred ', error);
  }
}

const isInBlacklist = (ip) => {
  if (!existsSync(BLACK_LIST_FILE)) {
    writeFileSync(BLACK_LIST_FILE, JSON.stringify([], null, 2), 'utf8');
  }
  const data = readFileSync(BLACK_LIST_FILE, { encoding: 'utf8', flag: 'r' });
  return data.includes(ip);
}

function proxySender(ws, conn) {
  ws.on('close', () => {
    conn.end();
  });

  ws.on('message', (cmd) => {
    try {
      const command = JSON.parse(cmd);
      const method = command.method;
      if (method === 'mining.subscribe' || method === 'mining.authorize' || method === 'mining.submit') {
        conn.write(cmd);
      }
    } catch (error) {
      console.log(`[Error][INTERNAL] ${error}`);
      ws.close();
    }
  });
}

function proxyReceiver(conn, cmdq) {
  conn.on('data', (data) => {
    cmdq.send(data.toString());
  });
  conn.on('end', () => {
    cmdq.close();
  });
  conn.on('error', (err) => {
    console.log(`[Error][${err.code}] ${err.message}`);
    conn.end();
  });
}

function proxyConnect(host, port) {
  const conn = net.createConnection(port, host);
  return conn;
}

function uidv1() {
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return [s4(), s4(), s4(), s4(), s4(), s4()].join('-');
};

function proxyMain(ws, req) {
  const ip = req.socket.remoteAddress;

  const uid = uidv1();

  if (!nodes[ip]) nodes[ip] = [];

  nodes[ip].push(uid);

  if (nodes[ip].length > MAX_CONNECTION_PER_IP) {
    addToBlackList(ip);
    console.error(`IP [${ip}] is banned!`);
  }

  ws.on('close', () => {
    nodes[ip] = nodes[ip].filter(o => o !== uid);
    if (nodes[ip].length === 0) {
      delete nodes[ip];
    }
  });

  ws.on('message', (message) => {
    const command = JSON.parse(message);
    if (command.method === 'proxy.connect' && command.params.length === 2) {
      const [host, port] = command.params || [];
      if (!host || !port) {
        ws.close();
        return;
      }

      const conn = proxyConnect(host, port);
      if (conn) {
        proxySender(ws, conn);
        proxyReceiver(conn, ws);
      }
    }
  });
}

wss.on('connection', proxyMain);

server.on('upgrade', function(req, socket) {
  const ip = req.socket.remoteAddress;
  if (isInBlacklist(ip)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
  }
})

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
