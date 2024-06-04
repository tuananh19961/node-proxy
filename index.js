const cluster = require('cluster');
const http = require('http');
const os = require('os');

const numCPUs = 4;

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  // Fork workers.
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`);
    cluster.fork(); // Restart the worker
  });
} else {
  // Workers can share any TCP connection
  // In this case, it is an HTTP server
  require('./server.js');
  console.log(`Worker ${process.pid} started`);
}
