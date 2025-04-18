import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import config from '../config';
import logger from '../utils/logger';
import {
  RollbarApiResponse,
  RollbarProject,
  RollbarItem,
  RollbarOccurrence,
  RollbarDeploy,
  RollbarItemStatus,
} from '../types/rollbar';

/**
 * Rollbar API Service
 * 
 * This service provides methods to interact with the Rollbar API.
 */
class RollbarApiService {
  private readonly apiBaseUrl: string;
  private readonly accessToken: string;
  private readonly accountReadToken: string;
  private readonly accountWriteToken: string;
  private readonly client: AxiosInstance;

  constructor() {
    this.apiBaseUrl = config.rollbar.apiBaseUrl;
    this.accessToken = config.rollbar.accessToken;
    this.accountReadToken = config.rollbar.accountReadToken;
    this.accountWriteToken = config.rollbar.accountWriteToken;

    // Create axios instance with default configuration
    this.client = axios.create({
      baseURL: this.apiBaseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`Rollbar API response: ${response.status} ${response.statusText}`);
        return response;
      },
      (error) => {
        if (error.response) {
          logger.error(`Rollbar API error: ${error.response.status} ${error.response.statusText}`);
          logger.error(`Error details: ${JSON.stringify(error.response.data)}`);
        } else if (error.request) {
          logger.error('Rollbar API error: No response received');
        } else {
          logger.error(`Rollbar API error: ${error.message}`);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Make a request to the Rollbar API
   */
  private async makeRequest<T>(
    method: string,
    endpoint: string,
    data?: any,
    params?: any,
    token?: string
  ): Promise<T> {
    const config: AxiosRequestConfig = {
      method,
      url: endpoint,
      headers: {
        'X-Rollbar-Access-Token': token || this.accessToken,
      },
    };

    if (data) {
      config.data = data;
    }

    if (params) {
      config.params = params;
    }

    try {
      const response: AxiosResponse<RollbarApiResponse<T>> = await this.client.request(config);
      
      if (response.data.err !== 0) {
        throw new Error(`Rollbar API error: ${JSON.stringify(response.data)}`);
      }
      
      return response.data.result;
    } catch (error) {
      logger.error(`Error making request to ${endpoint}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Get all projects
   */
  async getProjects(): Promise<RollbarProject[]> {
    return this.makeRequest<RollbarProject[]>('GET', '/projects', undefined, undefined, this.accountReadToken);
  }

  /**
   * Get a specific project by ID
   */
  async getProject(projectId: number): Promise<RollbarProject> {
    return this.makeRequest<RollbarProject>('GET', `/project/${projectId}`, undefined, undefined, this.accountReadToken);
  }

  /**
   * Get items (errors) for a project
   */
  async getItems(
    projectId: number,
    options: {
      status?: RollbarItemStatus;
      level?: string;
      environment?: string;
      query?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<RollbarItem[]> {
    const params = {
      status: options.status,
      level: options.level,
      environment: options.environment,
      q: options.query,
      limit: options.limit || 20,
      offset: options.offset || 0,
    };

    return this.makeRequest<RollbarItem[]>(
      'GET',
      `/project/${projectId}/items`,
      undefined,
      params,
      this.accountReadToken
    );
  }

  /**
   * Get a specific item by ID
   */
  async getItem(itemId: number): Promise<RollbarItem> {
    return this.makeRequest<RollbarItem>('GET', `/item/${itemId}`, undefined, undefined, this.accountReadToken);
  }

  /**
   * Get occurrences for an item
   */
  async getItemOccurrences(
    itemId: number,
    options: {
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<RollbarOccurrence[]> {
    const params = {
      limit: options.limit || 20,
      offset: options.offset || 0,
    };

    return this.makeRequest<RollbarOccurrence[]>(
      'GET',
      `/item/${itemId}/occurrences`,
      undefined,
      params,
      this.accountReadToken
    );
  }

  /**
   * Get a specific occurrence by ID
   */
  async getOccurrence(occurrenceId: number): Promise<RollbarOccurrence> {
    return this.makeRequest<RollbarOccurrence>(
      'GET',
      `/occurrence/${occurrenceId}`,
      undefined,
      undefined,
      this.accountReadToken
    );
  }

  /**
   * Resolve an item
   */
  async resolveItem(itemId: number): Promise<{ result: boolean }> {
    return this.makeRequest<{ result: boolean }>(
      'PATCH',
      `/item/${itemId}`,
      { status: 'resolved' },
      undefined,
      this.accountWriteToken
    );
  }

  /**
   * Create a new item (error report)
   */
  async createItem(data: {
    environment: string;
    level: string;
    title: string;
    message: string;
    framework?: string;
    code_version?: string;
    person?: {
      id: string | number;
      username?: string;
      email?: string;
    };
    custom?: Record<string, any>;
  }): Promise<{ id: number }> {
    const payload = {
      data: {
        environment: data.environment,
        body: {
          message: {
            body: data.message,
          },
        },
        level: data.level,
        title: data.title,
        framework: data.framework,
        code_version: data.code_version,
        person: data.person,
        custom: data.custom,
      },
    };

    return this.makeRequest<{ id: number }>('POST', '/item/', payload, undefined, this.accessToken);
  }

  /**
   * Get deploys for a project
   */
  async getDeploys(
    projectId: number,
    options: {
      environment?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<RollbarDeploy[]> {
    const params = {
      environment: options.environment,
      limit: options.limit || 20,
      offset: options.offset || 0,
    };

    return this.makeRequest<RollbarDeploy[]>(
      'GET',
      `/project/${projectId}/deploys`,
      undefined,
      params,
      this.accountReadToken
    );
  }

  /**
   * Track a deploy
   */
  async trackDeploy(data: {
    environment: string;
    revision: string;
    project_id: number;
    local_username?: string;
    comment?: string;
  }): Promise<RollbarDeploy> {
    return this.makeRequest<RollbarDeploy>(
      'POST',
      '/deploy',
      data,
      undefined,
      this.accountWriteToken
    );
  }

  /**
   * Search for items using RQL (Rollbar Query Language)
   */
  async searchItems(
    projectId: number,
    rql: string,
    options: {
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<RollbarItem[]> {
    const params = {
      rql,
      limit: options.limit || 20,
      offset: options.offset || 0,
    };

    return this.makeRequest<RollbarItem[]>(
      'GET',
      `/project/${projectId}/search`,
      undefined,
      params,
      this.accountReadToken
    );
  }
}

// Export a singleton instance
export default new RollbarApiService();
