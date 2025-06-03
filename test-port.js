#!/usr/bin/env node

const http = require('http');
const net = require('net');

// Port to test
const port = process.env.PORT || 10000;

console.log(`Testing port binding on port ${port}...`);

// First, check if the port is available
const testSocket = new net.Socket();

testSocket.on('error', (err) => {
  console.log(`Port ${port} check error: ${err.message}`);
  console.log('This could mean the port is already in use or not accessible.');
  process.exit(1);
});

testSocket.on('connect', () => {
  console.log(`Port ${port} is already in use. This could be a problem.`);
  testSocket.destroy();
  process.exit(1);
});

testSocket.on('timeout', () => {
  console.log(`Port ${port} connection attempt timed out. This is good, it means the port is likely available.`);
  testSocket.destroy();
  startServer();
});

testSocket.setTimeout(1000);
testSocket.connect(port, '0.0.0.0');

// Create a simple HTTP server to test port binding
function startServer() {
  const server = http.createServer((req, res) => {
    console.log(`Received request: ${req.method} ${req.url}`);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Port test server is running!\n');
  });

  server.on('error', (err) => {
    console.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`✓ Test server successfully bound to 0.0.0.0:${port}`);
    console.log('Server is now listening for requests.');
    console.log('Press Ctrl+C to stop the server.');
    
    // Send a test request to ourselves
    setTimeout(() => {
      console.log('Sending test request to our own server...');
      http.get(`http://localhost:${port}`, (res) => {
        console.log(`Got response: ${res.statusCode}`);
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          console.log(`Response body: ${data}`);
          console.log('Self-test successful! The server is properly binding and responding to requests.');
        });
      }).on('error', (err) => {
        console.error(`Self-test failed: ${err.message}`);
        console.log('This indicates a problem with the server binding.');
      });
    }, 1000);
  });
}
