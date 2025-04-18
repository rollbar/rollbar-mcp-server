import rollbarApi from './rollbar-api';
import logger from '../utils/logger';
import { McpErrorCodes } from '../types/mcp';
import { RollbarItemLevel } from '../types/rollbar';

/**
 * Tool Provider Interface
 */
interface ToolProvider {
  execute(params: Record<string, any>): Promise<any>;
}

/**
 * Resolve Item Tool Provider
 */
class ResolveItemToolProvider implements ToolProvider {
  async execute(params: Record<string, any>): Promise<any> {
    try {
      if (!params.itemId) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Item ID is required',
        };
      }

      const itemId = parseInt(params.itemId, 10);
      if (isNaN(itemId)) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Invalid item ID',
        };
      }

      const result = await rollbarApi.resolveItem(itemId);
      return {
        success: result.result,
        itemId,
      };
    } catch (error) {
      if (error.code) {
        throw error;
      }
      
      logger.error(`Error resolving item: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw {
        code: McpErrorCodes.INTERNAL_ERROR,
        message: 'Failed to resolve item in Rollbar',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }
}

/**
 * Create Item Tool Provider
 */
class CreateItemToolProvider implements ToolProvider {
  async execute(params: Record<string, any>): Promise<any> {
    try {
      // Validate required parameters
      if (!params.environment) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Environment is required',
        };
      }

      if (!params.level) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Level is required',
        };
      }

      if (!Object.values(RollbarItemLevel).includes(params.level)) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: `Invalid level. Must be one of: ${Object.values(RollbarItemLevel).join(', ')}`,
        };
      }

      if (!params.title) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Title is required',
        };
      }

      if (!params.message) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Message is required',
        };
      }

      const result = await rollbarApi.createItem({
        environment: params.environment,
        level: params.level,
        title: params.title,
        message: params.message,
        framework: params.framework,
        code_version: params.codeVersion,
        person: params.person,
        custom: params.custom,
      });

      return {
        success: true,
        itemId: result.id,
      };
    } catch (error) {
      if (error.code) {
        throw error;
      }
      
      logger.error(`Error creating item: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw {
        code: McpErrorCodes.INTERNAL_ERROR,
        message: 'Failed to create item in Rollbar',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }
}

/**
 * Track Deploy Tool Provider
 */
class TrackDeployToolProvider implements ToolProvider {
  async execute(params: Record<string, any>): Promise<any> {
    try {
      // Validate required parameters
      if (!params.environment) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Environment is required',
        };
      }

      if (!params.revision) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Revision is required',
        };
      }

      if (!params.projectId) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Project ID is required',
        };
      }

      const projectId = parseInt(params.projectId, 10);
      if (isNaN(projectId)) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Invalid project ID',
        };
      }

      const result = await rollbarApi.trackDeploy({
        environment: params.environment,
        revision: params.revision,
        project_id: projectId,
        local_username: params.username,
        comment: params.comment,
      });

      return {
        success: true,
        deployId: result.id,
        deploy: result,
      };
    } catch (error) {
      if (error.code) {
        throw error;
      }
      
      logger.error(`Error tracking deploy: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw {
        code: McpErrorCodes.INTERNAL_ERROR,
        message: 'Failed to track deploy in Rollbar',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }
}

/**
 * Search Items Tool Provider
 */
class SearchItemsToolProvider implements ToolProvider {
  async execute(params: Record<string, any>): Promise<any> {
    try {
      // Validate required parameters
      if (!params.projectId) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Project ID is required',
        };
      }

      const projectId = parseInt(params.projectId, 10);
      if (isNaN(projectId)) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Invalid project ID',
        };
      }

      if (!params.query) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Query is required',
        };
      }

      const items = await rollbarApi.searchItems(
        projectId,
        params.query,
        {
          limit: params.limit,
          offset: params.offset,
        }
      );

      return {
        items,
        count: items.length,
        query: params.query,
      };
    } catch (error) {
      if (error.code) {
        throw error;
      }
      
      logger.error(`Error searching items: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw {
        code: McpErrorCodes.INTERNAL_ERROR,
        message: 'Failed to search items in Rollbar',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }
}

// Map of tool names to their providers
const toolProviders: Record<string, ToolProvider> = {
  resolveItem: new ResolveItemToolProvider(),
  createItem: new CreateItemToolProvider(),
  trackDeploy: new TrackDeployToolProvider(),
  searchItems: new SearchItemsToolProvider(),
};

/**
 * Get a tool provider by name
 */
export const getToolProvider = (toolName: string): ToolProvider => {
  const provider = toolProviders[toolName];
  if (!provider) {
    throw {
      code: McpErrorCodes.TOOL_NOT_FOUND,
      message: `Tool '${toolName}' not found`,
    };
  }
  return provider;
};

/**
 * Get all available tool names
 */
export const getToolNames = (): string[] => {
  return Object.keys(toolProviders);
};
