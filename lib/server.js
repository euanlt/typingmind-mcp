const express = require('express');
const stringify = require('json-stable-stringify');
const cors = require('cors');
const fs = require('fs');
const https = require('https');
const { findAvailablePort } = require('./port-finder');
const { authMiddleware } = require('./auth');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StdioClientTransport,
  getDefaultEnvironment,
} = require('@modelcontextprotocol/sdk/client/stdio.js');

// Store active MCP clients
const clients = new Map();

// Helper function to start a client with given configuration
async function startClient(clientId, config) {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Starting MCP client: ${clientId}`);
  
  const { command, args = [], env = {} } = config;

  if (!command) {
    throw new Error('Command is required');
  }

  // Log the exact command being executed
  console.log(`[${new Date().toISOString()}] Command: ${command}`);
  console.log(`[${new Date().toISOString()}] Args: ${JSON.stringify(args)}`);
  console.log(`[${new Date().toISOString()}] Environment variables count: ${Object.keys(env).length}`);
  
  // Log environment variables (without sensitive values)
  Object.keys(env).forEach(key => {
    const value = key.toLowerCase().includes('key') || key.toLowerCase().includes('token') 
      ? '[REDACTED]' 
      : env[key];
    console.log(`[${new Date().toISOString()}] ENV ${key}: ${value}`);
  });

  console.log(`[${new Date().toISOString()}] Creating StdioClientTransport...`);
  const transportStartTime = Date.now();

  // Create transport for the MCP client
  const transport = new StdioClientTransport({
    command,
    args,
    env:
      Object.values(env).length > 0
        ? {
            // see https://github.com/modelcontextprotocol/typescript-sdk/issues/216
            ...getDefaultEnvironment(),
            ...env,
          }
        : undefined, // cannot be {}, it will cause error
  });

  console.log(`[${new Date().toISOString()}] Transport created in ${Date.now() - transportStartTime}ms`);

  // Create and initialize the client
  console.log(`[${new Date().toISOString()}] Creating MCP Client...`);
  const client = new Client({
    name: `mcp-http-bridge-${clientId}`,
    version: '1.0.0',
    timeout: 300000 // 5 minutes timeout
  }, {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {}
    }
  });

  // Add timeout wrapper for better error reporting
  console.log(`[${new Date().toISOString()}] Attempting to connect to transport...`);
  const connectStartTime = Date.now();
  
  try {
    // Create a promise that rejects after a custom timeout with detailed info
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        const elapsed = Date.now() - connectStartTime;
        reject(new Error(`Connection timeout after ${elapsed}ms. Client: ${clientId}, Command: ${command} ${args.join(' ')}`));
      }, 300000); // 5 minutes - enough time for npm install and build
    });

    // Race between connection and timeout
    await Promise.race([
      client.connect(transport),
      timeoutPromise
    ]);

    const connectTime = Date.now() - connectStartTime;
    const totalTime = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ✅ Client connected successfully!`);
    console.log(`[${new Date().toISOString()}] Connection time: ${connectTime}ms`);
    console.log(`[${new Date().toISOString()}] Total startup time: ${totalTime}ms`);

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[${new Date().toISOString()}] ❌ Connection failed after ${elapsed}ms`);
    console.error(`[${new Date().toISOString()}] Error details:`, error.message);
    console.error(`[${new Date().toISOString()}] Client: ${clientId}`);
    console.error(`[${new Date().toISOString()}] Command: ${command} ${args.join(' ')}`);
    throw error;
  }

  // Store the client with its ID
  clients.set(clientId, {
    id: clientId,
    client,
    transport,
    command,
    args,
    env,
    config, // Store original config for restart
    createdAt: new Date(),
  });

  const totalTime = Date.now() - startTime;
  console.log(`[${new Date().toISOString()}] ✅ Client ${clientId} fully initialized in ${totalTime}ms`);

  return {
    id: clientId,
    message: 'MCP client started successfully',
  };
}

/**
 * Start the MCP server
 * @param {string} authToken Authentication token
 * @returns {Promise<{port: number}>} The port the server is running on
 */
async function start(authToken) {
  const app = express();

  // Find an available port
  const port = process.env.PORT || (await findAvailablePort());
  if (!port) {
    throw new Error(
      'No available ports found. Please specify a port by using the PORT environment variable.'
    );
  }

  // Configure middleware with more specific CORS settings
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
  app.use(express.json());
  
  // Serve static files from /tmp directory for image access
  app.use('/files', express.static('/tmp'));
  
  // Trust proxy for Render deployment
  app.set('trust proxy', true);
  
  // Add request logging middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });
  
  // Keep-alive interval to prevent idle timeouts
  setInterval(() => {
    console.log('Keep-alive ping at', new Date().toISOString());
  }, 30000); // Every 30 seconds

  // Add authentication to all endpoints
  const auth = authMiddleware(authToken);

  // Root route handler
  app.get('/', (req, res) => {
    res.status(200).send('MCP Server is running. Use /public-health for health checks.');
  });

  // Health check endpoint
  app.get('/ping', auth, (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Public health check endpoint (no auth required)
  app.get('/public-health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  
  // Simple test endpoint for port scanning (no auth required)
  app.get('/port-test', (req, res) => {
    res.status(200).send('Port is open and server is responding');
  });

  // Start MCP clients using Claude Desktop config format
  app.post('/start', auth, async (req, res) => {
    try {
      const { mcpServers } = req.body;

      const results = {
        success: [],
        errors: [],
      };

      // Process each server configuration
      const startPromises = Object.entries(mcpServers).map(
        async ([serverId, config]) => {
          try {
            // Check if this client already exists
            if (clients.has(serverId)) {
              const hasConfigChanged =
                stringify(clients.get(serverId).config) !== stringify(config);
              if (!hasConfigChanged) {
                return;
              }
              console.log('Restarting client with new config:', serverId);
              clients.get(serverId).client.close();
            }

            const result = await startClient(serverId, config);
            results.success.push(result);
          } catch (error) {
            console.error(`Failed to initialize client ${serverId}:`, error);
            results.errors.push({
              id: serverId,
              error: `Failed to initialize: ${error.message}`,
            });
          }
        }
      );

      // Wait for all clients to be processed
      await Promise.all(startPromises);

      // Return appropriate response
      if (results.errors.length === 0) {
        return res.status(201).json({
          message: 'All MCP clients started successfully',
          clients: results.success,
        });
      } else {
        return res.status(400).json({
          message: 'Some MCP clients failed to start',
          success: results.success,
          errors: results.errors,
        });
      }
    } catch (error) {
      console.error('Error starting clients:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Restart a specific client
  app.post('/restart/:id', auth, async (req, res) => {
    const { id } = req.params;
    const clientEntry = clients.get(id);

    if (!clientEntry) {
      return res.status(404).json({ error: 'Client not found' });
    }

    try {
      // Get the original configuration
      const config = clientEntry.config || {
        command: clientEntry.command,
        args: clientEntry.args,
        env: clientEntry.env,
      };

      // Close the existing client
      await clientEntry.client.close();
      clients.delete(id);

      // Start a new client with the same configuration
      const result = await startClient(id, config);

      return res.status(200).json({
        message: `Client ${id} restarted successfully`,
        client: result,
      });
    } catch (error) {
      console.error(`Error restarting client ${id}:`, error);
      return res.status(500).json({
        error: 'Failed to restart client',
        details: error.message,
      });
    }
  });

  app.get('/clients', auth, async (req, res) => {
    try {
      // Create an array of promises that will fetch tools for each client
      const clientDetailsPromises = Array.from(clients.values()).map(
        async (clientEntry) => {
          const { id, command, args, createdAt } = clientEntry;

          try {
            // Get tools for this client
            const result = await clientEntry.client.listTools();
            const tools = result.tools || [];

            // Extract just the tool names into an array
            const toolNames = tools.map((tool) => tool.name);

            return {
              id,
              command,
              args,
              createdAt,
              tools: toolNames,
            };
          } catch (error) {
            console.error(`Error getting tools for client ${id}:`, error);
            return {
              id,
              command,
              args,
              createdAt,
              tools: [],
              toolError: error.message,
            };
          }
        }
      );

      // Wait for all promises to resolve
      const clientsList = await Promise.all(clientDetailsPromises);

      res.status(200).json(clientsList);
    } catch (error) {
      console.error('Error fetching clients list:', error);
      res.status(500).json({
        error: 'Failed to retrieve clients list',
        details: error.message,
      });
    }
  });

  app.get('/clients/:id', auth, (req, res) => {
    const clientId = req.params.id;
    const clientEntry = clients.get(clientId);

    if (!clientEntry) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { id, command, args, createdAt } = clientEntry;

    res.status(200).json({ id, command, args, createdAt });
  });

  // Get tools for a specific client
  app.get('/clients/:id/tools', auth, async (req, res) => {
    const { id } = req.params;
    const clientEntry = clients.get(id);

    if (!clientEntry) {
      return res.status(404).json({ error: 'Client not found' });
    }

    try {
      const result = await clientEntry.client.listTools();
      res.status(200).json(result.tools);
    } catch (error) {
      console.error(`Error getting tools for client ${id}:`, error);
      res.status(500).json({
        error: 'Failed to get tools',
        details: error.message,
      });
    }
  });

  // Call a tool for a specific client
  app.post('/clients/:id/call_tools', auth, async (req, res) => {
    const { id } = req.params;
    const { name, arguments: toolArgs } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Tool name is required' });
    }

    const clientEntry = clients.get(id);
    if (!clientEntry) {
      return res.status(404).json({ error: 'Client not found' });
    }

    try {
      const result = await clientEntry.client.callTool({
        name,
        arguments: toolArgs || {},
      });

      res.status(200).json(result);
    } catch (error) {
      console.error(`Error calling tool for client ${id}:`, error);
      res.status(500).json({
        error: 'Failed to call tool',
        details: error.message,
      });
    }
  });

  // Clean up resources for a client
  app.delete('/clients/:id', auth, async (req, res) => {
    const { id } = req.params;
    const clientEntry = clients.get(id);

    if (!clientEntry) {
      return res.status(404).json({ error: 'Client not found' });
    }

    try {
      // Close the client properly
      await clientEntry.client.close();
      clients.delete(id);

      res.status(200).json({ message: 'Client deleted successfully' });
    } catch (error) {
      console.error(`Error deleting client ${id}:`, error);
      res.status(500).json({
        error: 'Failed to delete client',
        details: error.message,
      });
    }
  });

  // Global error handler
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
      error: 'Internal server error',
      details: err.message,
    });
  });

  // Start the server (HTTP or HTTPS)
  return new Promise((resolve, reject) => {
    const host = '0.0.0.0';

    // Check if certificate and key files are specified
    const certFile = process.env.CERTFILE;
    const keyFile = process.env.KEYFILE;

    let server;

    console.log(`Attempting to bind to ${host}:${port}...`);
    console.log(`Environment: PORT=${process.env.PORT}, RENDER=${process.env.RENDER || 'not set'}`);

    // Function to handle successful server start
    const handleServerStart = (protocol) => {
      console.log(`Server successfully bound to ${host}:${port} (${protocol})`);
      console.log(`Server is ready to accept connections`);
      
      // Add a small delay to ensure the port is fully registered
      setTimeout(() => {
        resolve({ port, host, protocol });
      }, 1000);
    };

    if (certFile && keyFile) {
      try {
        // Read certificate files
        const httpsOptions = {
          cert: fs.readFileSync(certFile),
          key: fs.readFileSync(keyFile),
        };

        // Create HTTPS server
        server = https.createServer(httpsOptions, app);
        
        // Handle server errors
        server.on('error', (err) => {
          console.error(`HTTPS server error: ${err.message}`);
          reject(err);
        });
        
        server.listen(port, host, () => handleServerStart('HTTPS'));
      } catch (error) {
        console.error('Error setting up HTTPS server:', error);
        reject(error);
      }
    } else {
      // Create HTTP server (fallback)
      server = app.listen(port, host);
      
      // Handle server errors
      server.on('error', (err) => {
        console.error(`HTTP server error: ${err.message}`);
        reject(err);
      });
      
      server.on('listening', () => handleServerStart('HTTP'));
    }

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down MCP server...');
      server.close(() => {
        process.exit(0);
      });
    });
  });
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
  console.log('Shutting down server...');

  // Close all clients
  for (const [id, clientEntry] of clients.entries()) {
    try {
      await clientEntry.client.close();
      console.log(`Closed client ${id}`);
    } catch (error) {
      console.error(`Error closing client ${id}:`, error);
    }
  }

  process.exit(0);
});

module.exports = {
  start,
};
