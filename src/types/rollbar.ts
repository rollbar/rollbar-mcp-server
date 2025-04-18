/**
 * Rollbar API Types
 * 
 * These types define the structure of the Rollbar API responses and requests.
 */

// Rollbar Project
export interface RollbarProject {
  id: number;
  name: string;
  account_id: number;
  status: string;
  date_created: number;
  date_modified: number;
  settings?: {
    timezone?: string;
    notification_settings?: any;
  };
}

// Rollbar Item (Error)
export interface RollbarItem {
  id: number;
  counter: number;
  environment: string;
  framework: string;
  title: string;
  level: string;
  status: string;
  first_occurrence_timestamp: number;
  last_occurrence_timestamp: number;
  total_occurrences: number;
  resolved_in_version?: string;
  activating_occurrence_id?: number;
}

// Rollbar Occurrence (Instance of an error)
export interface RollbarOccurrence {
  id: number;
  project_id: number;
  item_id: number;
  timestamp: number;
  language: string;
  level: string;
  framework: string;
  context?: string;
  body: {
    trace?: {
      frames: RollbarFrame[];
      exception: {
        class: string;
        message: string;
      };
    };
    message?: {
      body: string;
    };
    crash_report?: any;
  };
  request?: {
    url: string;
    method: string;
    headers: Record<string, string>;
    params: Record<string, any>;
    GET?: Record<string, any>;
    POST?: Record<string, any>;
    body?: string;
    user_ip?: string;
  };
  person?: {
    id: string | number;
    username?: string;
    email?: string;
  };
  client?: {
    javascript?: {
      browser: string;
      code_version?: string;
      source_map_enabled?: boolean;
      guess_uncaught_frames?: boolean;
    };
  };
  server?: {
    host?: string;
    root?: string;
    branch?: string;
    code_version?: string;
  };
  notifier?: {
    name: string;
    version: string;
  };
  metadata?: Record<string, any>;
}

// Rollbar Stack Frame
export interface RollbarFrame {
  filename: string;
  lineno: number;
  colno?: number;
  method: string;
  code?: string;
  context?: {
    pre?: string[];
    post?: string[];
  };
  args?: any[];
  locals?: Record<string, any>;
}

// Rollbar Deploy
export interface RollbarDeploy {
  id: number;
  environment: string;
  revision: string;
  local_username?: string;
  comment?: string;
  status?: string;
  project_id: number;
  timestamp: number;
}

// Rollbar API Response
export interface RollbarApiResponse<T> {
  err: number;
  result: T;
}

// Rollbar API Error
export interface RollbarApiError {
  err: number;
  message: string;
}

// Rollbar Item Status
export enum RollbarItemStatus {
  ACTIVE = 'active',
  RESOLVED = 'resolved',
  MUTED = 'muted',
  ARCHIVED = 'archived',
}

// Rollbar Item Level
export enum RollbarItemLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}
