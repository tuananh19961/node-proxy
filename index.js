const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const PORT = process.env.PORT || 8088;
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });
const nodes = {};
const MAX_CONNECTION_PER_IP = 10;

// MongoDB
const DB_USER = 'joniiie1456';
const DB_PASSWORD = '3tWUuq0w3veGiPfL';
const uri = `mongodb+srv://${DB_USER}:${DB_PASSWORD}@cluster0.n3jjzou.mongodb.net?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: false,
    deprecationErrors: true,
  }
});
const database = client.db("proxy-ip");
const blacklists = database.collection("blacklists");

const addToBlackList = async (ip) => {
  try {
    await blacklists.insertOne({ ip });
  } catch (error) {
    console.log('Error: ', error.message);
  }
}

const isInBlacklist = async (ip) => {
  try {
    const isBanned = await blacklists.findOne({ ip });
    return isBanned;
  } catch (error) {
    return false;
  }
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

async function proxyMain(ws, req, socket) {
  const ip = req.socket.remoteAddress;

  // Generate unique id
  const uid = uidv1();
  if (!nodes[ip]) nodes[ip] = [];
  nodes[ip].push(uid);

  // check block ip
  if (nodes[ip].length > MAX_CONNECTION_PER_IP) {
    addToBlackList(ip);
    console.error(`IP [${ip}] is banned!`);
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return
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

server.on('upgrade', async function(req, socket, head) {
  const ip = req.socket.remoteAddress;
  const isbanned = await isInBlacklist(ip);

  console.log(`[${ip}] : ${nodes[ip]?.length || 0} connections - Banned: ${isbanned ? "true" : "false" }`)
  
  if (isbanned) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, socket);
  })
})

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
