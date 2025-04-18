import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { RollbarClient } from '../api/rollbar-client.js';
import { config } from '../config.js';
import { EventEmitter } from 'events';

/**
 * Create and configure the Rollbar MCP server
 */
export function createRollbarMcpServer() {
  // Create the Rollbar API client
  const rollbarClient = new RollbarClient(config.rollbarAccessToken);

  // Create the MCP server
  const server = new McpServer({
    name: 'Rollbar',
    version: '0.1.0',
    description: 'MCP server for Rollbar error tracking',
  }) as McpServer & EventEmitter;

  // Add logging for connection events
  server.on('connect', () => {
    console.log('MCP server connected to transport');
  });

  server.on('disconnect', () => {
    console.log('MCP server disconnected from transport');
  });

  server.on('error', (error: Error) => {
    console.error('MCP server error:', error);
  });

  server.on('session:start', (sessionId: string) => {
    console.log(`New session started: ${sessionId}`);
  });

  server.on('session:end', (sessionId: string) => {
    console.log(`Session ended: ${sessionId}`);
  });

  server.on('tool:call', (sessionId: string, toolName: string, params: unknown) => {
    console.log(`Tool call in session ${sessionId}: ${toolName}`, params);
  });

  // Add tools for interacting with Rollbar

  // List projects
  server.tool(
    'list-projects',
    {},
    async () => {
      try {
        const projects = await rollbarClient.getProjects();
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                projects.map(project => ({
                  id: project.id,
                  name: project.name,
                  status: project.status,
                })),
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        console.error('Error listing projects:', error);
        return {
          content: [
            {
              type: 'text',
              text: `Error listing projects: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Get project details
  server.tool(
    'get-project',
    { projectId: z.number() },
    async ({ projectId }) => {
      try {
        const project = await rollbarClient.getProject(projectId);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(project, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error(`Error getting project ${projectId}:`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error getting project ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // List items (errors) for a project
  server.tool(
    'list-items',
    {
      projectId: z.number(),
      status: z.enum(['active', 'resolved', 'muted']).optional(),
      level: z.array(z.enum(['critical', 'error', 'warning', 'info', 'debug'])).optional(),
      environment: z.string().optional(),
      page: z.number().int().positive().optional(),
      count: z.number().int().positive().max(100).optional(),
    },
    async ({ projectId, status, level, environment, page, count }) => {
      try {
        const items = await rollbarClient.getItems(projectId, {
          status,
          level,
          environment,
          page,
          count,
        });
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                items.map(item => ({
                  id: item.id,
                  title: item.title,
                  level: item.level,
                  environment: item.environment,
                  status: item.status,
                  occurrences: item.total_occurrences,
                  lastOccurrence: new Date(item.last_occurrence_timestamp * 1000).toISOString(),
                })),
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        console.error(`Error listing items for project ${projectId}:`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error listing items for project ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Get item details
  server.tool(
    'get-item',
    { itemId: z.number() },
    async ({ itemId }) => {
      try {
        const item = await rollbarClient.getItem(itemId);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(item, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error(`Error getting item ${itemId}:`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error getting item ${itemId}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Get occurrences for an item
  server.tool(
    'get-item-occurrences',
    {
      itemId: z.number(),
      page: z.number().int().positive().optional(),
      count: z.number().int().positive().max(100).optional(),
    },
    async ({ itemId, page, count }) => {
      try {
        const occurrences = await rollbarClient.getItemOccurrences(itemId, {
          page,
          count,
        });
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                occurrences.map(occurrence => ({
                  id: occurrence.id,
                  timestamp: new Date(occurrence.timestamp * 1000).toISOString(),
                  level: occurrence.level,
                  language: occurrence.language,
                  framework: occurrence.framework,
                  context: occurrence.context,
                  message: occurrence.body.message?.body,
                  hasTrace: !!occurrence.body.trace || (occurrence.body.trace_chain && occurrence.body.trace_chain.length > 0),
                })),
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        console.error(`Error getting occurrences for item ${itemId}:`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error getting occurrences for item ${itemId}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Get occurrence details
  server.tool(
    'get-occurrence',
    {
      itemId: z.number(),
      occurrenceId: z.string(),
    },
    async ({ itemId, occurrenceId }) => {
      try {
        const occurrence = await rollbarClient.getOccurrence(itemId, occurrenceId);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(occurrence, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error(`Error getting occurrence ${occurrenceId} for item ${itemId}:`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error getting occurrence ${occurrenceId} for item ${itemId}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Update item status
  server.tool(
    'update-item-status',
    {
      itemId: z.number(),
      status: z.enum(['active', 'resolved', 'muted']),
    },
    async ({ itemId, status }) => {
      try {
        await rollbarClient.updateItemStatus(itemId, status);
        
        return {
          content: [
            {
              type: 'text',
              text: `Successfully updated item ${itemId} status to ${status}`,
            },
          ],
        };
      } catch (error) {
        console.error(`Error updating status for item ${itemId}:`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error updating status for item ${itemId}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Search for items
  server.tool(
    'search-items',
    {
      projectId: z.number(),
      query: z.string(),
      status: z.enum(['active', 'resolved', 'muted']).optional(),
      level: z.array(z.enum(['critical', 'error', 'warning', 'info', 'debug'])).optional(),
      environment: z.string().optional(),
      page: z.number().int().positive().optional(),
      count: z.number().int().positive().max(100).optional(),
    },
    async ({ projectId, query, status, level, environment, page, count }) => {
      try {
        const items = await rollbarClient.searchItems(
          projectId,
          query,
          {
            status,
            level,
            environment,
            page,
            count,
          }
        );
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                items.map(item => ({
                  id: item.id,
                  title: item.title,
                  level: item.level,
                  environment: item.environment,
                  status: item.status,
                  occurrences: item.total_occurrences,
                  lastOccurrence: new Date(item.last_occurrence_timestamp * 1000).toISOString(),
                })),
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        console.error(`Error searching items for project ${projectId}:`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error searching items for project ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  return server;
}
