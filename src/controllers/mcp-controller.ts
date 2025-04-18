import { Request, Response } from 'express';
import { 
  JsonRpcRequest, 
  JsonRpcResponse, 
  McpErrorCodes,
  InitializeParams,
  InitializeResult,
  GetResourceParams,
  ExecuteToolParams,
} from '../types/mcp';
import logger from '../utils/logger';
import { getResourceProvider, getResourceTypes } from '../services/resource-providers';
import { getToolProvider, getToolNames } from '../services/tool-providers';
import { verifyToken, generateToken } from '../middleware/auth';
import { version } from '../../package.json';

/**
 * MCP Controller
 * 
 * This controller handles MCP protocol requests.
 */
export default class McpController {
  /**
   * Handle MCP request
   */
  public async handleRequest(req: Request, res: Response): Promise<void> {
    try {
      const request = req.body as JsonRpcRequest;
      
      // Validate JSON-RPC 2.0 request
      if (!request || request.jsonrpc !== '2.0' || !request.method) {
        this.sendErrorResponse(res, {
          jsonrpc: '2.0',
          id: request?.id || null,
          error: {
            code: McpErrorCodes.INVALID_REQUEST,
            message: 'Invalid JSON-RPC 2.0 request',
          },
        });
        return;
      }
      
      logger.info(`Received MCP request: ${request.method}`, { id: request.id });
      
      // Handle request based on method
      let response: JsonRpcResponse;
      
      switch (request.method) {
        case 'initialize':
          response = await this.handleInitialize(request);
          break;
        
        case 'getResource':
          response = await this.handleGetResource(request);
          break;
        
        case 'executeTool':
          response = await this.handleExecuteTool(request);
          break;
        
        default:
          response = {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: McpErrorCodes.METHOD_NOT_FOUND,
              message: `Method '${request.method}' not found`,
            },
          };
      }
      
      // Send response
      res.json(response);
      
    } catch (error) {
      logger.error(`Error handling MCP request: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      this.sendErrorResponse(res, {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: McpErrorCodes.INTERNAL_ERROR,
          message: 'Internal server error',
          data: { error: error instanceof Error ? error.message : 'Unknown error' },
        },
      });
    }
  }
  
  /**
   * Handle initialize method
   */
  private async handleInitialize(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      const params = request.params as InitializeParams;
      
      // Handle authentication if provided
      let userId = 'anonymous';
      let userName = 'Anonymous User';
      
      if (params.authentication?.token) {
        const payload = verifyToken(params.authentication.token);
        
        if (payload) {
          userId = payload.userId;
          userName = payload.name;
        } else {
          // Generate a new token for anonymous access
          // In a production environment, you would validate credentials here
          const token = generateToken(userId, userName);
          
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              serverInfo: {
                name: 'Rollbar MCP Server',
                version,
              },
              capabilities: {
                resources: getResourceTypes(),
                tools: getToolNames(),
              },
              authentication: {
                token,
              },
            } as InitializeResult,
          };
        }
      } else {
        // Generate a new token for anonymous access
        // In a production environment, you would validate credentials here
        const token = generateToken(userId, userName);
        
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            serverInfo: {
              name: 'Rollbar MCP Server',
              version,
            },
            capabilities: {
              resources: getResourceTypes(),
              tools: getToolNames(),
            },
            authentication: {
              token,
            },
          } as InitializeResult,
        };
      }
      
      // Return server info and capabilities
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          serverInfo: {
            name: 'Rollbar MCP Server',
            version,
          },
          capabilities: {
            resources: getResourceTypes(),
            tools: getToolNames(),
          },
        } as InitializeResult,
      };
    } catch (error) {
      logger.error(`Error handling initialize: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: McpErrorCodes.INTERNAL_ERROR,
          message: 'Failed to initialize',
          data: { error: error instanceof Error ? error.message : 'Unknown error' },
        },
      };
    }
  }
  
  /**
   * Handle getResource method
   */
  private async handleGetResource(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      const params = request.params as GetResourceParams;
      
      if (!params.resourceType) {
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: McpErrorCodes.INVALID_PARAMS,
            message: 'Resource type is required',
          },
        };
      }
      
      try {
        const provider = getResourceProvider(params.resourceType);
        
        if (params.resourceId) {
          // Get a specific resource
          const resource = await provider.getResource(params.resourceId, params.options);
          
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: resource,
          };
        } else {
          // Get all resources of this type
          const resources = await provider.getResources(params.options);
          
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: resources,
          };
        }
      } catch (error) {
        if (error.code) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: error.code,
              message: error.message,
              data: error.data,
            },
          };
        }
        
        throw error;
      }
    } catch (error) {
      logger.error(`Error handling getResource: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: McpErrorCodes.INTERNAL_ERROR,
          message: 'Failed to get resource',
          data: { error: error instanceof Error ? error.message : 'Unknown error' },
        },
      };
    }
  }
  
  /**
   * Handle executeTool method
   */
  private async handleExecuteTool(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      const params = request.params as ExecuteToolParams;
      
      if (!params.toolName) {
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: McpErrorCodes.INVALID_PARAMS,
            message: 'Tool name is required',
          },
        };
      }
      
      try {
        const provider = getToolProvider(params.toolName);
        const result = await provider.execute(params.params || {});
        
        return {
          jsonrpc: '2.0',
          id: request.id,
          result,
        };
      } catch (error) {
        if (error.code) {
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: error.code,
              message: error.message,
              data: error.data,
            },
          };
        }
        
        throw error;
      }
    } catch (error) {
      logger.error(`Error handling executeTool: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: McpErrorCodes.INTERNAL_ERROR,
          message: 'Failed to execute tool',
          data: { error: error instanceof Error ? error.message : 'Unknown error' },
        },
      };
    }
  }
  
  /**
   * Send error response
   */
  private sendErrorResponse(res: Response, errorResponse: JsonRpcResponse): void {
    res.status(this.getHttpStatusFromErrorCode((errorResponse as any).error.code)).json(errorResponse);
  }
  
  /**
   * Get HTTP status code from MCP error code
   */
  private getHttpStatusFromErrorCode(errorCode: number): number {
    switch (errorCode) {
      case McpErrorCodes.PARSE_ERROR:
      case McpErrorCodes.INVALID_REQUEST:
      case McpErrorCodes.INVALID_PARAMS:
      case McpErrorCodes.VALIDATION_ERROR:
        return 400;
      
      case McpErrorCodes.UNAUTHORIZED:
        return 401;
      
      case McpErrorCodes.FORBIDDEN:
        return 403;
      
      case McpErrorCodes.METHOD_NOT_FOUND:
      case McpErrorCodes.RESOURCE_NOT_FOUND:
      case McpErrorCodes.TOOL_NOT_FOUND:
      case McpErrorCodes.RESOURCE_TYPE_NOT_FOUND:
        return 404;
      
      case McpErrorCodes.INTERNAL_ERROR:
      default:
        return 500;
    }
  }
}
