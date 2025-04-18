import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
dotenv.config();

// Define configuration schema
const configSchema = z.object({
  rollbarAccessToken: z.string().min(1),
  rollbarApiBaseUrl: z.string().url(),
  port: z.coerce.number().int().positive(),
});

// Parse and validate configuration
export const config = {
  rollbarAccessToken: process.env.ROLLBAR_ACCESS_TOKEN || '',
  rollbarApiBaseUrl: process.env.ROLLBAR_API_BASE_URL || 'https://api.rollbar.com/api/1',
  port: parseInt(process.env.PORT || '3000', 10),
};

// Validate configuration (will throw if invalid)
try {
  configSchema.parse(config);
} catch (error) {
  console.error('Invalid configuration:', error);
  process.exit(1);
}
