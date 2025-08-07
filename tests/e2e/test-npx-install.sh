#!/bin/bash

# E2E test to verify the package works when installed via npm/npx
# This simulates what happens when users run: npx @rollbar/mcp-server

set -e  # Exit on error

echo "Starting E2E test for npx installation..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the project root directory
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_ROOT"

# Clean up function
cleanup() {
    echo -e "${YELLOW}Cleaning up...${NC}"
    if [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR"
    fi
    if [ -f "$TARBALL" ]; then
        rm -f "$TARBALL"
    fi
}

# Set up trap to clean up on exit
trap cleanup EXIT

echo "Step 1: Building the package..."
npm run build

echo "Step 2: Creating npm package tarball..."
TARBALL=$(npm pack 2>&1 | tail -n 1)
echo "Created tarball: $TARBALL"

echo "Step 3: Creating temporary test directory..."
TEMP_DIR=$(mktemp -d)
echo "Temp directory: $TEMP_DIR"

echo "Step 4: Installing package in temp directory..."
cd "$TEMP_DIR"
npm init -y > /dev/null 2>&1
npm install "$PROJECT_ROOT/$TARBALL"

echo "Step 5: Testing the installed package..."

# Create a test script that sends an MCP initialize request
cat > test-mcp.js << 'EOF'
const { spawn } = require('child_process');

// MCP initialize request
const initRequest = JSON.stringify({
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    protocolVersion: "1.0.0",
    capabilities: {},
    clientInfo: {
      name: "test-client",
      version: "1.0.0"
    }
  },
  id: 1
}) + '\n';

// Spawn the MCP server
const server = spawn('node', ['node_modules/@rollbar/mcp-server/build/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, ROLLBAR_ACCESS_TOKEN: 'test-token' }
});

let output = '';
let errorOutput = '';
let timeout;

// Handle stdout
server.stdout.on('data', (data) => {
  output += data.toString();
  
  // Check if we received a valid response
  const lines = output.split('\n');
  for (const line of lines) {
    if (line.trim() && line.startsWith('{')) {
      try {
        const response = JSON.parse(line);
        if (response.jsonrpc === '2.0') {
          console.log('SUCCESS: Received valid MCP response');
          clearTimeout(timeout);
          server.kill();
          process.exit(0);
        }
      } catch (e) {
        // Not valid JSON yet, continue collecting
      }
    }
  }
});

// Handle stderr
server.stderr.on('data', (data) => {
  errorOutput += data.toString();
  
  // Check for module resolution errors
  if (errorOutput.includes('ERR_PACKAGE_PATH_NOT_EXPORTED') || 
      errorOutput.includes('Cannot find module')) {
    console.error('ERROR: Module resolution failed');
    console.error(errorOutput);
    clearTimeout(timeout);
    process.exit(1);
  }
});

// Handle server exit
server.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error('ERROR: Server exited with code', code);
    console.error('stderr:', errorOutput);
    process.exit(1);
  }
});

// Set timeout
timeout = setTimeout(() => {
  console.error('ERROR: Test timed out');
  console.error('stdout:', output);
  console.error('stderr:', errorOutput);
  server.kill();
  process.exit(1);
}, 10000);

// Send initialize request
server.stdin.write(initRequest);
EOF

echo "Step 6: Running MCP server test..."
if node test-mcp.js; then
    echo -e "${GREEN}✓ E2E test passed!${NC}"
    echo "The package works correctly when installed via npm/npx"
    exit 0
else
    echo -e "${RED}✗ E2E test failed!${NC}"
    echo "The package has issues when installed via npm/npx"
    exit 1
fi