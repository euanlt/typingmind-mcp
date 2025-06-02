#!/usr/bin/env node

const server = require('../lib/server');
const chalk = require('chalk');

// Get auth token from command line arguments or environment variable
const authToken = process.argv[2] || process.env.MCP_AUTH_TOKEN;

if (!authToken) {
  console.error(chalk.red('Error: Authentication token is required'));
  console.log('Usage: npx @typingmind/mcp <auth-token>');
  console.log('       OR set MCP_AUTH_TOKEN environment variable');
  process.exit(1);
}

// Start the server with the provided auth token
server
  .start(authToken)
  .then(({ host, port, protocol }) => {
    console.log(
      chalk.green(`✓ MCP runner server running on ${protocol}://${host}:${port}`),
    );
    
    // Add information about the external URL if available (for cloud platforms like Render)
    if (process.env.RENDER_EXTERNAL_URL) {
      console.log(
        chalk.green(`✓ External URL: ${process.env.RENDER_EXTERNAL_URL}`),
      );
    } else {
      console.log(
        chalk.green(`✓ External URL: ${protocol}://localhost:${port} (for local access)`),
      );
    }
    
    console.log(
      chalk.yellow(
        'Note: You must keep the server running in the background in order to use MCP in TypingMind.',
      ),
    );
  })
  .catch((err) => {
    console.error(chalk.red(`Error starting MCP server: ${err.message}`));
    process.exit(1);
  });
