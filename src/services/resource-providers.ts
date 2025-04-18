import rollbarApi from './rollbar-api';
import logger from '../utils/logger';
import { McpErrorCodes } from '../types/mcp';

/**
 * Resource Provider Interface
 */
interface ResourceProvider {
  getResources(options?: Record<string, any>): Promise<any[]>;
  getResource(id: string, options?: Record<string, any>): Promise<any>;
}

/**
 * Projects Resource Provider
 */
class ProjectsResourceProvider implements ResourceProvider {
  async getResources(options?: Record<string, any>): Promise<any[]> {
    try {
      const projects = await rollbarApi.getProjects();
      return projects;
    } catch (error) {
      logger.error(`Error getting projects: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw {
        code: McpErrorCodes.INTERNAL_ERROR,
        message: 'Failed to retrieve projects from Rollbar',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }

  async getResource(id: string, options?: Record<string, any>): Promise<any> {
    try {
      const projectId = parseInt(id, 10);
      if (isNaN(projectId)) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Invalid project ID',
        };
      }

      const project = await rollbarApi.getProject(projectId);
      return project;
    } catch (error) {
      if (error.code) {
        throw error;
      }
      
      logger.error(`Error getting project: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw {
        code: McpErrorCodes.INTERNAL_ERROR,
        message: 'Failed to retrieve project from Rollbar',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }
}

/**
 * Items Resource Provider
 */
class ItemsResourceProvider implements ResourceProvider {
  async getResources(options?: Record<string, any>): Promise<any[]> {
    try {
      if (!options?.projectId) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Project ID is required',
        };
      }

      const projectId = parseInt(options.projectId, 10);
      if (isNaN(projectId)) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Invalid project ID',
        };
      }

      const items = await rollbarApi.getItems(projectId, {
        status: options.status,
        level: options.level,
        environment: options.environment,
        query: options.query,
        limit: options.limit,
        offset: options.offset,
      });

      return items;
    } catch (error) {
      if (error.code) {
        throw error;
      }
      
      logger.error(`Error getting items: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw {
        code: McpErrorCodes.INTERNAL_ERROR,
        message: 'Failed to retrieve items from Rollbar',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }

  async getResource(id: string, options?: Record<string, any>): Promise<any> {
    try {
      const itemId = parseInt(id, 10);
      if (isNaN(itemId)) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Invalid item ID',
        };
      }

      const item = await rollbarApi.getItem(itemId);
      return item;
    } catch (error) {
      if (error.code) {
        throw error;
      }
      
      logger.error(`Error getting item: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw {
        code: McpErrorCodes.INTERNAL_ERROR,
        message: 'Failed to retrieve item from Rollbar',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }
}

/**
 * Occurrences Resource Provider
 */
class OccurrencesResourceProvider implements ResourceProvider {
  async getResources(options?: Record<string, any>): Promise<any[]> {
    try {
      if (!options?.itemId) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Item ID is required',
        };
      }

      const itemId = parseInt(options.itemId, 10);
      if (isNaN(itemId)) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Invalid item ID',
        };
      }

      const occurrences = await rollbarApi.getItemOccurrences(itemId, {
        limit: options.limit,
        offset: options.offset,
      });

      return occurrences;
    } catch (error) {
      if (error.code) {
        throw error;
      }
      
      logger.error(`Error getting occurrences: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw {
        code: McpErrorCodes.INTERNAL_ERROR,
        message: 'Failed to retrieve occurrences from Rollbar',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }

  async getResource(id: string, options?: Record<string, any>): Promise<any> {
    try {
      const occurrenceId = parseInt(id, 10);
      if (isNaN(occurrenceId)) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Invalid occurrence ID',
        };
      }

      const occurrence = await rollbarApi.getOccurrence(occurrenceId);
      return occurrence;
    } catch (error) {
      if (error.code) {
        throw error;
      }
      
      logger.error(`Error getting occurrence: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw {
        code: McpErrorCodes.INTERNAL_ERROR,
        message: 'Failed to retrieve occurrence from Rollbar',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }
}

/**
 * Deploys Resource Provider
 */
class DeploysResourceProvider implements ResourceProvider {
  async getResources(options?: Record<string, any>): Promise<any[]> {
    try {
      if (!options?.projectId) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Project ID is required',
        };
      }

      const projectId = parseInt(options.projectId, 10);
      if (isNaN(projectId)) {
        throw {
          code: McpErrorCodes.INVALID_PARAMS,
          message: 'Invalid project ID',
        };
      }

      const deploys = await rollbarApi.getDeploys(projectId, {
        environment: options.environment,
        limit: options.limit,
        offset: options.offset,
      });

      return deploys;
    } catch (error) {
      if (error.code) {
        throw error;
      }
      
      logger.error(`Error getting deploys: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw {
        code: McpErrorCodes.INTERNAL_ERROR,
        message: 'Failed to retrieve deploys from Rollbar',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
      };
    }
  }

  async getResource(id: string, options?: Record<string, any>): Promise<any> {
    // Rollbar API doesn't provide a direct way to get a deploy by ID
    // This is a placeholder for future implementation
    throw {
      code: McpErrorCodes.METHOD_NOT_FOUND,
      message: 'Getting a deploy by ID is not supported',
    };
  }
}

// Map of resource types to their providers
const resourceProviders: Record<string, ResourceProvider> = {
  projects: new ProjectsResourceProvider(),
  items: new ItemsResourceProvider(),
  occurrences: new OccurrencesResourceProvider(),
  deploys: new DeploysResourceProvider(),
};

/**
 * Get a resource provider by type
 */
export const getResourceProvider = (resourceType: string): ResourceProvider => {
  const provider = resourceProviders[resourceType];
  if (!provider) {
    throw {
      code: McpErrorCodes.RESOURCE_TYPE_NOT_FOUND,
      message: `Resource type '${resourceType}' not found`,
    };
  }
  return provider;
};

/**
 * Get all available resource types
 */
export const getResourceTypes = (): string[] => {
  return Object.keys(resourceProviders);
};
