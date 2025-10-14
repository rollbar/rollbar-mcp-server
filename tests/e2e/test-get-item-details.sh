#!/bin/bash

# E2E test to verify get-item-details works via npx
# Tests that the tool can be invoked without errors

set -e  # Exit on error

echo "Starting E2E test for get-item-details via npx..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the project root directory
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_ROOT"

# Check if jq is available
if ! command -v jq &> /dev/null; then
    echo -e "${RED}✗ jq is required for this test but not installed${NC}"
    exit 1
fi

# Check if ROLLBAR_E2E_READ_TOKEN is set
if [ -z "$ROLLBAR_E2E_READ_TOKEN" ]; then
    echo -e "${RED}✗ ROLLBAR_E2E_READ_TOKEN environment variable is required${NC}"
    exit 1
fi

# Clean up function
cleanup() {
    echo -e "${YELLOW}Cleaning up...${NC}"
    if [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR"
    fi
    if [ -f "$TARBALL" ]; then
        rm -f "$TARBALL"
    fi
    if [ -f "test-output.json" ]; then
        rm -f test-output.json
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

echo "Step 4: Testing get-item-details via npx..."
cd "$TEMP_DIR"

# Copy the tarball to temp dir for npx to use
cp "$PROJECT_ROOT/$TARBALL" .

echo "Running: npx --yes --no-install @modelcontextprotocol/inspector --cli -e ROLLBAR_ACCESS_TOKEN=\$ROLLBAR_E2E_READ_TOKEN npx --yes ./$TARBALL --method tools/call --tool-name get-item-details --tool-arg counter=8 --tool-arg max_tokens=100"

# Run the command and capture output
npx --yes --no-install @modelcontextprotocol/inspector --cli -e ROLLBAR_ACCESS_TOKEN=$ROLLBAR_E2E_READ_TOKEN npx --yes ./$TARBALL --method tools/call --tool-name get-item-details --tool-arg counter=8 --tool-arg max_tokens=100 > test-output.json 2>&1

# Check the output using jq
HAS_CONTENT=$(jq -r 'has("content")' test-output.json 2>/dev/null || echo "false")
IS_ERROR=$(jq -r '.isError // false' test-output.json 2>/dev/null || echo "true")

if [ "$HAS_CONTENT" = "true" ] && [ "$IS_ERROR" = "false" ]; then
    echo -e "${GREEN}✓ E2E test passed!${NC}"
    echo "get-item-details works correctly via npx"
    exit 0
else
    echo -e "${RED}✗ E2E test failed: Tool invocation returned an error${NC}"
    echo "Response:"
    cat test-output.json
    exit 1
fi
