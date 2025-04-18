#!/bin/bash

# Exit on error
set -e

echo "Setting up Rollbar MCP Server..."

# Install dependencies
echo "Installing dependencies..."
npm install

# Build the project
echo "Building the project..."
npm run build

echo "Setup complete! You can now run the server with 'npm start'"
echo "Don't forget to create a .env file with your Rollbar API token."
