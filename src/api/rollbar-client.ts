import axios, { AxiosInstance } from 'axios';
import { config } from '../config.js';

/**
 * Types for Rollbar API responses
 */
export interface RollbarProject {
  id: number;
  name: string;
  status: string;
  account_id: number;
  date_created: number;
  date_modified: number;
}

export interface RollbarItem {
  id: number;
  counter: number;
  environment: string;
  framework: string;
  level: string;
  timestamp: number;
  title: string;
  status: string;
  total_occurrences: number;
  last_occurrence_timestamp: number;
}

export interface RollbarOccurrence {
  id: string;
  timestamp: number;
  body: {
    trace?: any;
    trace_chain?: any[];
    message?: {
      body: string;
    };
  };
  level: string;
  language: string;
  framework: string;
  context?: string;
  request?: {
    url: string;
    method: string;
    headers: Record<string, string>;
    params: Record<string, string>;
    body?: string;
  };
}

/**
 * Client for interacting with the Rollbar API
 */
export class RollbarClient {
  private client: AxiosInstance;

  constructor(accessToken: string, baseURL: string = config.rollbarApiBaseUrl) {
    this.client = axios.create({
      baseURL,
      headers: {
        'X-Rollbar-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Get a list of all projects
   */
  async getProjects(): Promise<RollbarProject[]> {
    const response = await this.client.get('/projects');
    return response.data.result;
  }

  /**
   * Get a specific project by ID
   */
  async getProject(projectId: number): Promise<RollbarProject> {
    const response = await this.client.get(`/project/${projectId}`);
    return response.data.result;
  }

  /**
   * Get a list of items (errors) for a project
   */
  async getItems(
    projectId: number,
    options: {
      status?: string;
      level?: string[];
      environment?: string;
      page?: number;
      count?: number;
    } = {}
  ): Promise<RollbarItem[]> {
    const params = new URLSearchParams();
    
    if (options.status) params.append('status', options.status);
    if (options.environment) params.append('environment', options.environment);
    if (options.page) params.append('page', options.page.toString());
    if (options.count) params.append('count', options.count.toString());
    
    if (options.level && options.level.length > 0) {
      options.level.forEach(level => params.append('level', level));
    }

    const response = await this.client.get(`/project/${projectId}/items?${params.toString()}`);
    return response.data.result.items;
  }

  /**
   * Get a specific item by ID
   */
  async getItem(itemId: number): Promise<RollbarItem> {
    const response = await this.client.get(`/item/${itemId}`);
    return response.data.result;
  }

  /**
   * Get occurrences for a specific item
   */
  async getItemOccurrences(
    itemId: number,
    options: {
      page?: number;
      count?: number;
    } = {}
  ): Promise<RollbarOccurrence[]> {
    const params = new URLSearchParams();
    
    if (options.page) params.append('page', options.page.toString());
    if (options.count) params.append('count', options.count.toString());

    const response = await this.client.get(`/item/${itemId}/instances?${params.toString()}`);
    return response.data.result.instances;
  }

  /**
   * Get a specific occurrence by ID
   */
  async getOccurrence(itemId: number, occurrenceId: string): Promise<RollbarOccurrence> {
    const response = await this.client.get(`/item/${itemId}/instance/${occurrenceId}`);
    return response.data.result;
  }

  /**
   * Update the status of an item
   */
  async updateItemStatus(itemId: number, status: 'active' | 'resolved' | 'muted'): Promise<void> {
    await this.client.patch(`/item/${itemId}`, {
      status
    });
  }

  /**
   * Search for items by title
   */
  async searchItems(
    projectId: number,
    query: string,
    options: {
      status?: string;
      level?: string[];
      environment?: string;
      page?: number;
      count?: number;
    } = {}
  ): Promise<RollbarItem[]> {
    const params = new URLSearchParams();
    
    params.append('query', query);
    if (options.status) params.append('status', options.status);
    if (options.environment) params.append('environment', options.environment);
    if (options.page) params.append('page', options.page.toString());
    if (options.count) params.append('count', options.count.toString());
    
    if (options.level && options.level.length > 0) {
      options.level.forEach(level => params.append('level', level));
    }

    const response = await this.client.get(`/project/${projectId}/search?${params.toString()}`);
    return response.data.result.items;
  }
}
