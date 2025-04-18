import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

const config = {
  // Server configuration
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development',
  },
  
  // JWT configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'default_jwt_secret_key_change_in_production',
    expiresIn: process.env.JWT_EXPIRATION || '1h',
  },
  
  // Rollbar API configuration
  rollbar: {
    accessToken: process.env.ROLLBAR_ACCESS_TOKEN || '',
    accountReadToken: process.env.ROLLBAR_ACCOUNT_READ_TOKEN || '',
    accountWriteToken: process.env.ROLLBAR_ACCOUNT_WRITE_TOKEN || '',
    apiBaseUrl: 'https://api.rollbar.com/api/1',
  },
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    directory: process.env.LOG_DIRECTORY || path.join(process.cwd(), 'logs'),
  },
};

// Validate required configuration
const validateConfig = () => {
  const requiredEnvVars = [
    'JWT_SECRET',
    'ROLLBAR_ACCESS_TOKEN',
    'ROLLBAR_ACCOUNT_READ_TOKEN',
    'ROLLBAR_ACCOUNT_WRITE_TOKEN',
  ];
  
  const missingEnvVars = requiredEnvVars.filter(
    (envVar) => !process.env[envVar]
  );
  
  if (missingEnvVars.length > 0) {
    console.warn(
      `Warning: Missing required environment variables: ${missingEnvVars.join(
        ', '
      )}`
    );
    
    if (config.server.env === 'production') {
      throw new Error(
        `Missing required environment variables: ${missingEnvVars.join(', ')}`
      );
    }
  }
};

// Only validate in non-test environments
if (process.env.NODE_ENV !== 'test') {
  validateConfig();
}

export default config;
