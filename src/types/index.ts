// Define interfaces for Rollbar API responses
export interface RollbarApiResponse<T> {
  err: number;
  result: T;
}

export interface RollbarItemResponse {
  id: number;
  counter: number;
  environment: string;
  framework: string;
  title: string;
  timestamp: number;
  last_occurrence_id: number;
  last_occurrence_timestamp: number;
  level: string;
  project_id: number;
  language: string;
  platform: string;
  hash: string;
  exception?: any;
  request?: any;
  body?: any;
  data: {
    body: any;
    level: string;
    environment: string;
    framework: string;
    language: string;
    timestamp: number;
    platform: string;
    request?: {
      url: string;
      method: string;
    };
    exception?: {
      class: string;
      message: string;
      description: string;
    };
    [key: string]: any; // Allow for any other properties
  };
  [key: string]: any; // Allow for any other properties
}

export interface RollbarTopItemResponse {
  id: number;
  environment: string;
  title: string;
  last_occurrence_timestamp: number;
  project_id: number;
  unique_occurrences: number;
  occurrences: number;
  framework: string;
  level: string;
  counter: number;
  group_status: number;
  [key: string]: any; // Allow for any other properties
}

export interface RollbarOccurrenceResponse {
  id: number;
  item_id: number;
  timestamp: number;
  version: number;
  data: {
    body: any;
    level: string;
    environment: string;
    framework: string;
    language: string;
    timestamp: number;
    platform: string;
    request?: {
      url: string;
      method: string;
    };
    exception?: {
      class: string;
      message: string;
      description: string;
    };
    context?: string;
    code_version?: string;
    stack_trace?: any;
    metadata?: any;
    [key: string]: any; // Allow for any other properties
  };
  [key: string]: any; // Allow for any other properties
}

export interface RollbarDeployResponse {
  environment: string;
  revision: string;
  local_username: string;
  comment: string;
  status: string;
  id: number;
  project_id: number;
  user_id: number;
  start_time: number;
  finish_time: number;
  [key: string]: any; // Allow for any other properties
}

export interface RollbarVersionsResponse {
  id: number;
  version: string;
  environment: string;
  date_created: number;
  first_occurrence_id: number;
  first_occurrence_timestamp: number;
  last_occurrence_id: number;
  last_occurrence_timestamp: number;
  deployed_by: string;
  last_deploy_timestamp: number;
  [key: string]: any; // Allow for any other properties
}
