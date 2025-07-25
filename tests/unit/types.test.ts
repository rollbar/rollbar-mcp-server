import { describe, it, expect } from 'vitest';
import type { 
  RollbarApiResponse, 
  RollbarItemResponse,
  RollbarListItemsResponse 
} from '../../src/types/index.js';

describe('Rollbar Types', () => {
  it('should validate RollbarApiResponse structure', () => {
    const response: RollbarApiResponse<{ test: string }> = {
      err: 0,
      result: { test: 'value' },
      message: 'optional message'
    };

    expect(response.err).toBeDefined();
    expect(response.result).toBeDefined();
  });

  it('should handle error responses', () => {
    const errorResponse: RollbarApiResponse<any> = {
      err: 1,
      result: null as any,
      message: 'Invalid access token'
    };

    expect(errorResponse.err).not.toBe(0);
    expect(errorResponse.message).toBeDefined();
  });

  it('should validate list response pagination', () => {
    const listResponse: Partial<RollbarListItemsResponse> = {
      page: 1,
      total_count: 100,
      items: []
    };

    expect(listResponse.page).toBe(1);
    expect(listResponse.total_count).toBe(100);
    expect(listResponse.items).toHaveLength(0);
  });
});