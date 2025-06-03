const net = require('net');

// List of ports to try in order
const PORTS = [50880, 50881, 3000, 8080, 8000];

/**
 * Check if a port is available
 * @param {number} port The port to check
 * @returns {Promise<boolean>} True if the port is available
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err) => {
      console.log(`Port ${port} is not available: ${err.message}`);
      resolve(false);
    });

    server.once('listening', () => {
      console.log(`Port ${port} is available`);
      server.close();
      resolve(true);
    });

    server.listen(port, '0.0.0.0');
  });
}

/**
 * Find an available port from the list
 * @returns {Promise<number|null>} The available port or null if none found
 */
async function findAvailablePort() {
  // If PORT environment variable is set, try that first
  if (process.env.PORT) {
    const envPort = parseInt(process.env.PORT, 10);
    console.log(`Checking environment-provided port: ${envPort}`);
    
    // On Render, we don't need to check if the port is available
    // as it's guaranteed to be available for our service
    if (process.env.RENDER) {
      console.log(`Running on Render, using provided port: ${envPort}`);
      return envPort;
    }
    
    if (await isPortAvailable(envPort)) {
      return envPort;
    }
    console.log(`Environment-provided port ${envPort} is not available, trying fallback ports`);
  }

  // Try the predefined ports
  for (const port of PORTS) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  
  console.log('No available ports found from the predefined list');
  return null;
}

module.exports = {
  findAvailablePort,
};
