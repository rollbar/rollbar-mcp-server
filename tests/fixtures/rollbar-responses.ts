import { 
  RollbarApiResponse, 
  RollbarItemResponse, 
  RollbarDeployResponse,
  RollbarVersionsResponse,
  RollbarListItemsResponse,
  RollbarTopItemResponse,
  RollbarOccurrenceResponse
} from '../../src/types/index.js';

export const mockSuccessfulDeployResponse: RollbarApiResponse<RollbarDeployResponse> = {
  err: 0,
  result: {
    environment: "production",
    revision: "abc123",
    local_username: "deploy-bot",
    comment: "Deploy version 1.2.3",
    status: "succeeded",
    id: 12345,
    project_id: 1,
    user_id: 100,
    start_time: 1640000000,
    finish_time: 1640001000,
  }
};

export const mockSuccessfulItemResponse: RollbarApiResponse<RollbarItemResponse> = {
  err: 0,
  result: {
    id: 1,
    counter: 42,
    environment: "production",
    framework: "node",
    title: "TypeError: Cannot read property 'foo' of undefined",
    timestamp: 1640000000,
    last_occurrence_id: 999,
    last_occurrence_timestamp: 1640001000,
    level: "error",
    project_id: 1,
    language: "javascript",
    platform: "server",
    hash: "abcdef123456",
    data: {
      body: {},
      level: "error",
      environment: "production",
      framework: "node",
      language: "javascript",
      timestamp: 1640000000,
      platform: "server"
    }
  }
};

export const mockSuccessfulOccurrenceResponse: RollbarApiResponse<RollbarOccurrenceResponse> = {
  err: 0,
  result: {
    id: 999,
    item_id: 1,
    timestamp: 1640001000,
    version: 1,
    data: {
      body: {
        trace: {
          frames: [],
          exception: {
            class: "TypeError",
            message: "Cannot read property 'foo' of undefined"
          }
        }
      },
      level: "error",
      environment: "production",
      framework: "node",
      language: "javascript",
      timestamp: 1640001000,
      platform: "server",
      metadata: {
        sensitive: "data"
      }
    }
  }
};

export const mockSuccessfulVersionResponse: RollbarApiResponse<RollbarVersionsResponse> = {
  err: 0,
  result: {
    id: 1,
    version: "v1.2.3",
    environment: "production",
    date_created: 1640000000,
    first_occurrence_id: 1,
    first_occurrence_timestamp: 1640000000,
    last_occurrence_id: 999,
    last_occurrence_timestamp: 1640001000,
    deployed_by: "deploy-bot",
    last_deploy_timestamp: 1640000000
  }
};

export const mockSuccessfulListItemsResponse: RollbarApiResponse<RollbarListItemsResponse> = {
  err: 0,
  result: {
    page: 1,
    total_count: 100,
    items: [
      {
        public_item_id: 1,
        integrations_data: "",
        level_lock: 0,
        controlling_id: 1,
        last_activated_timestamp: 1640000000,
        assigned_user_id: 0,
        group_status: 1,
        hash: "abc123",
        id: 1,
        environment: "production",
        title_lock: 0,
        title: "Error 1",
        last_occurrence_id: 100,
        platform: "server",
        last_occurrence_timestamp: 1640001000,
        first_occurrence_timestamp: 1640000000,
        project_id: 1,
        resolved_in_version: "",
        status: "active",
        unique_occurrences: 10,
        group_item_id: 1,
        framework: "node",
        level: "error",
        total_occurrences: 50,
        counter: 1,
        last_modified_by: 0,
        first_occurrence_id: 1,
        activating_occurrence_id: 1,
        last_resolved_timestamp: 0
      }
    ]
  }
};

export const mockSuccessfulTopItemsResponse: RollbarApiResponse<RollbarTopItemResponse> = {
  err: 0,
  result: {
    id: 1,
    environment: "production",
    title: "Top Error",
    last_occurrence_timestamp: 1640001000,
    project_id: 1,
    unique_occurrences: 100,
    occurrences: 500,
    framework: "node",
    level: "error",
    counter: 1,
    group_status: 1
  }
};

export const mockErrorResponse = {
  err: 1,
  message: "Invalid access token"
};

export const mock401Response = {
  status: 401,
  statusText: "Unauthorized",
  body: JSON.stringify({ message: "Invalid access token" })
};

export const mock404Response = {
  status: 404,
  statusText: "Not Found",
  body: JSON.stringify({ message: "Item not found" })
};

export const mock500Response = {
  status: 500,
  statusText: "Internal Server Error",
  body: "Internal server error"
};