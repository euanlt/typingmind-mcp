#!/usr/bin/env node

const http = require('http');

// Port to test
const port = process.env.PORT || 10000;

console.log(`Attempting to bind directly to port ${port}...`);
console.log(`Environment variables: PORT=${process.env.PORT}, RENDER=${process.env.RENDER}`);

// Create a simple HTTP server to test port binding
const server = http.createServer((req, res) => {
  console.log(`Received request: ${req.method} ${req.url}`);
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Port test server is running!\n');
});

server.on('error', (err) => {
  console.error(`Failed to start server: ${err.message}`);
  console.error('This could indicate a port conflict or permission issue.');
  process.exit(1);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`✓ Test server successfully bound to 0.0.0.0:${port}`);
  console.log('Server is now listening for requests.');
  console.log('Press Ctrl+C to stop the server.');
  
  // Send a test request to ourselves after a delay
  setTimeout(() => {
    console.log('Sending test request to our own server...');
    
    // Try both localhost and 127.0.0.1 to ensure we can connect
    const testUrl = `http://127.0.0.1:${port}`;
    console.log(`Testing connection to ${testUrl}`);
    
    http.get(testUrl, (res) => {
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
      console.log('This indicates a problem with the server binding or internal networking.');
      console.log('However, the server may still be accessible from outside the container.');
    });
  }, 2000);
});
