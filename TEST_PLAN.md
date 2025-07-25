# Test Plan for Rollbar MCP Server

## Overview

This document outlines the comprehensive testing strategy for the Rollbar MCP (Model Context Protocol) server. The test suite ensures reliability, maintainability, and correctness of all server components.

## Test Framework

- **Framework**: Vitest (v3.2.4)
- **Coverage Tool**: @vitest/coverage-v8
- **Environment**: Node.js
- **Type Checking**: TypeScript strict mode

## Test Commands

```bash
npm test          # Run all tests once
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

## Coverage Requirements

Minimum coverage thresholds:
- **Statements**: 80%
- **Branches**: 80%
- **Functions**: 90%
- **Lines**: 80%

## Test Structure

```
tests/
├── unit/                  # Unit tests for individual modules
│   ├── config.vitest.test.ts
│   ├── types.test.ts
│   ├── utils/
│   │   └── api.test.ts
│   └── tools/
│       ├── get-deployments.test.ts
│       ├── get-item-details.test.ts
│       ├── get-top-items.test.ts
│       ├── get-version.test.ts
│       └── list-items.test.ts
├── integration/           # Integration tests
│   └── server.test.ts
└── fixtures/             # Test data and mocks
    └── rollbar-responses.ts
```

## Test Categories

### 1. Unit Tests

#### Configuration Module (`src/config.ts`)
- ✅ Verify correct API base URL constant
- ✅ Verify correct user agent format
- ✅ Test environment variable loading
- ⬜ Test behavior with missing environment variables
- ⬜ Test dotenv configuration loading

#### API Utilities (`src/utils/api.ts`)
- ⬜ Test successful API request handling
- ⬜ Test missing ROLLBAR_ACCESS_TOKEN error
- ⬜ Test HTTP error responses (401, 403, 404, 500)
- ⬜ Test network failure handling
- ⬜ Test JSON parsing errors
- ⬜ Test error message extraction from responses
- ⬜ Test correct headers in requests

#### Type Definitions (`src/types/index.ts`)
- ✅ Validate RollbarApiResponse structure
- ✅ Validate error response handling
- ✅ Validate list response pagination
- ⬜ Test all interface structures match API
- ⬜ Test optional vs required fields

#### MCP Tools

For each tool (`get-deployments`, `get-item-details`, `get-top-items`, `get-version`, `list-items`):

- ⬜ Test successful API response handling
- ⬜ Test API error responses (err !== 0)
- ⬜ Test null/undefined response handling
- ⬜ Test parameter validation with Zod schemas
- ⬜ Test default parameter values
- ⬜ Test response formatting
- ⬜ Test error message formatting
- ⬜ Test URL construction with parameters

### 2. Integration Tests

#### MCP Server (`src/index.ts`)
- ⬜ Test server initialization
- ⬜ Test all tools are registered correctly
- ⬜ Test missing ROLLBAR_ACCESS_TOKEN prevents startup
- ⬜ Test server lifecycle (start/stop)
- ⬜ Test MCP protocol compliance
- ⬜ Test concurrent tool calls
- ⬜ Test error propagation through MCP

### 3. End-to-End Tests

- ⬜ Test complete flow: MCP client → server → Rollbar API → response
- ⬜ Test rate limiting behavior
- ⬜ Test timeout handling
- ⬜ Test large response handling

## Mock Strategy

### API Mocking
- Use Vitest's `vi.mock()` for module mocking
- Mock `fetch` globally for API tests
- Create fixture files for all Rollbar API responses
- Mock both successful and error responses

### Environment Mocking
- Mock process.env for configuration tests
- Mock dotenv to prevent loading actual .env files
- Isolate tests from system environment

### MCP SDK Mocking
- Mock McpServer for tool registration tests
- Mock server lifecycle methods
- Verify correct tool schemas and handlers

## Test Data (Fixtures)

Located in `tests/fixtures/rollbar-responses.ts`:

- ✅ `mockSuccessfulDeployResponse` - Valid deployment data
- ✅ `mockSuccessfulItemResponse` - Valid item details
- ✅ `mockSuccessfulOccurrenceResponse` - Valid occurrence data
- ✅ `mockSuccessfulVersionResponse` - Valid version data
- ✅ `mockSuccessfulListItemsResponse` - Valid paginated list
- ✅ `mockSuccessfulTopItemsResponse` - Valid top items
- ✅ `mockErrorResponse` - API error with message
- ✅ `mock401Response` - Unauthorized error
- ✅ `mock404Response` - Not found error
- ✅ `mock500Response` - Server error

## Implementation Status

### Completed ✅
1. Test framework setup (Vitest)
2. Basic configuration tests
3. Type validation tests
4. Test fixtures for all response types
5. Coverage configuration

### In Progress 🔄
1. API utility unit tests
2. Individual tool unit tests

### Not Started ⬜
1. Integration tests
2. End-to-end tests
3. Error scenario testing
4. Performance tests

## Best Practices

1. **Test Isolation**: Each test should be independent
2. **Mock External Dependencies**: Never make real API calls
3. **Clear Test Names**: Describe what is being tested
4. **Arrange-Act-Assert**: Follow AAA pattern
5. **Test Edge Cases**: Include error scenarios
6. **Use Type Safety**: Leverage TypeScript in tests
7. **Keep Tests Simple**: One assertion per test when possible
8. **Mock at Boundaries**: Mock external modules, not internal functions

## Running Tests in CI/CD

```yaml
# Example GitHub Actions workflow
- name: Run Tests
  run: |
    npm ci
    npm run lint
    npm run test:coverage
    
- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info
```

## Debugging Tests

1. Use `test.only()` to run single test
2. Use `describe.skip()` to skip test suites
3. Add `console.log()` for debugging (remove before commit)
4. Use VS Code's Vitest extension for debugging
5. Check `coverage/index.html` for uncovered lines

## Future Enhancements

1. **Performance Testing**: Add benchmarks for API response times
2. **Load Testing**: Test concurrent request handling
3. **Security Testing**: Validate token handling and data sanitization
4. **Mutation Testing**: Ensure test quality with mutation testing
5. **Visual Regression**: Test CLI output formatting
6. **Contract Testing**: Validate against Rollbar API schema changes

## Maintenance

- Review and update tests when adding new features
- Update fixtures when Rollbar API changes
- Monitor test execution time and optimize slow tests
- Keep coverage above minimum thresholds
- Regularly update testing dependencies