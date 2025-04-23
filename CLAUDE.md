# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands
- Build: `npm run build`
- Lint: `npm run lint`
- Fix lint issues: `npm run lint:fix`
- Format check: `npm run format`
- Format write: `npm run format:write`
- Test individual tool: `npx @modelcontextprotocol/inspector --cli -e ROLLBAR_ACCESS_TOKEN=$TOKEN node build/index.js --method tools/call --tool-name TOOL_NAME --tool-arg ARG_NAME=ARG_VALUE --debug`

## Code Style Guidelines
- TypeScript with strict type checking
- ES Modules with Node16 module resolution
- Prettier for formatting (runs via ESLint)
- Error handling: Use try/catch blocks with typed errors
- Imports: Use `.js` extension in import paths for ESM compatibility
- Interface naming: Prefix with descriptive name (e.g., `RollbarApiResponse`)
- API interactions: Use helper functions like `makeRollbarRequest`
- Environment: Use dotenv for configuration
- Type safety: Use Zod for runtime type validation
- Error responses: Return structured error messages with type info