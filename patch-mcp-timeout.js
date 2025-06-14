#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔧 Patching MCP SDK timeout...');

// Path to the MCP SDK protocol file
const protocolPath = path.join(__dirname, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'shared', 'protocol.js');

try {
  // Check if the file exists
  if (!fs.existsSync(protocolPath)) {
    console.log('⚠️  MCP SDK protocol file not found, skipping patch');
    process.exit(0);
  }

  // Read the file
  let content = fs.readFileSync(protocolPath, 'utf8');
  
  // Check if already patched
  if (content.includes('timeout: 300000') || content.includes('300000')) {
    console.log('✅ MCP SDK timeout already patched');
    process.exit(0);
  }

  // Replace the hardcoded 60000ms timeout with 300000ms (5 minutes)
  const originalPattern = /timeout:\s*60000/g;
  const patchedContent = content.replace(originalPattern, 'timeout: 300000');
  
  // Also patch any other 60000 values that might be timeout-related
  const fallbackPattern = /60000/g;
  const finalContent = patchedContent.replace(fallbackPattern, (match, offset) => {
    // Only replace if it's in a timeout context
    const context = content.substring(Math.max(0, offset - 50), offset + 50);
    if (context.toLowerCase().includes('timeout') || context.includes('RequestTimeout')) {
      return '300000';
    }
    return match;
  });

  // Write the patched file
  fs.writeFileSync(protocolPath, finalContent, 'utf8');
  
  console.log('✅ Successfully patched MCP SDK timeout from 60s to 5min');
  console.log(`📁 Patched file: ${protocolPath}`);
  
} catch (error) {
  console.error('❌ Error patching MCP SDK:', error.message);
  process.exit(1);
}
