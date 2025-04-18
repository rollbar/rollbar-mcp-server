/**
 * MCP Protocol Types
 * 
 * These types define the structure of the MCP (Machine Consumable Protocol) messages
 * used for communication between AI coding tools and the Rollbar MCP server.
 */

// JSON-RPC 2.0 Request
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params: Record<string, any>;
}

// JSON-RPC 2.0 Success Response
export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: number | string;
  result: any;
}

// JSON-RPC 2.0 Error Response
export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  error: {
    code: number;
    message: string;
    data?: any;
  };
}

// JSON-RPC 2.0 Response (Success or Error)
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// MCP Initialize Request Params
export interface InitializeParams {
  capabilities?: {
    [key: string]: any;
  };
  authentication?: {
    token?: string;
  };
}

// MCP Initialize Result
export interface InitializeResult {
  serverInfo: {
    name: string;
    version: string;
  };
  capabilities: {
    resources: string[];
    tools: string[];
  };
}

// MCP Get Resource Request Params
export interface GetResourceParams {
  resourceType: string;
  resourceId?: string;
  options?: Record<string, any>;
}

// MCP Execute Tool Request Params
export interface ExecuteToolParams {
  toolName: string;
  params: Record<string, any>;
}

// MCP Error Codes
export enum McpErrorCodes {
  // JSON-RPC 2.0 Error Codes
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
  
  // MCP-specific Error Codes
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  RESOURCE_NOT_FOUND = 404,
  TOOL_NOT_FOUND = 4041,
  RESOURCE_TYPE_NOT_FOUND = 4042,
  VALIDATION_ERROR = 422,
}
