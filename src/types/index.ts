// Define interfaces for Rollbar API responses
export interface RollbarApiResponse<T> {
  err: number;
  result: T;
  message?: string;
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
  // group_status distinguishes a native item (1) from an aggregate/group
  // item (2) — see mox/model/constants.py GROUP_STATUS and
  // mox/responses/internalapi/items.py:item_for_id, which serializes this
  // field on both GET /item/?counter= and GET /item/{id}.
  group_status?: number;
  group_item_id?: number;
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

export interface RollbarListItemResponse {
  public_item_id: number;
  integrations_data: string;
  level_lock: number;
  controlling_id: number;
  last_activated_timestamp: number;
  assigned_user_id: number;
  group_status: number;
  hash: string;
  id: number;
  environment: string;
  title_lock: number;
  title: string;
  last_occurrence_id: number;
  platform: string;
  last_occurrence_timestamp: number;
  first_occurrence_timestamp: number;
  project_id: number;
  resolved_in_version: string;
  status: string;
  unique_occurrences: number;
  group_item_id: number;
  framework: string;
  level: string;
  total_occurrences: number;
  counter: number;
  last_modified_by: number;
  first_occurrence_id: number;
  activating_occurrence_id: number;
  last_resolved_timestamp: number;
  [key: string]: any; // Allow for any other properties
}

export interface RollbarListItemsResponse {
  page: number;
  total_count: number;
  items: RollbarListItemResponse[];
  [key: string]: any; // Allow for any other properties
}

export interface RollbarListOccurrencesResponse {
  page: number;
  instances: RollbarOccurrenceResponse[];
  [key: string]: any; // Allow for any other properties
}

export interface RollbarItemCommentResponse {
  id: number;
  type: "comment" | "resolve_note";
  item_id: number;
  user_id: number;
  username: string;
  timestamp: number;
  // Nullable: the backend serializes text from stored comment data, and a
  // comment record without a text key returns "text": null.
  text: string | null;
  // Not emitted by the endpoint yet; ships with API-authored comments
  // (mox #13781), which tags comments created via POST with via_api.
  via_api?: boolean;
  [key: string]: unknown;
}

export interface RollbarListItemCommentsResponse {
  comments: RollbarItemCommentResponse[];
  page: number;
  total_count: number;
  [key: string]: unknown;
}
