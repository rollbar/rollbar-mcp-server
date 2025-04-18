import app from './app';
import config from './config';
import logger from './utils/logger';

// Start the server
const server = app.listen(config.server.port, () => {
  logger.info(`Rollbar MCP Server is running on port ${config.server.port} in ${config.server.env} mode`);
});

// Handle graceful shutdown
const gracefulShutdown = () => {
  logger.info('Received shutdown signal, closing server...');
  
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  
  // Force close after 10s
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

// Listen for termination signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  gracefulShutdown();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason });
  gracefulShutdown();
});

export default server;
