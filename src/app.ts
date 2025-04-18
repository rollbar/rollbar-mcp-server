import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mcpRoutes from './routes/mcp-routes';
import logger from './utils/logger';
import config from './config';

// Create Express application
const app = express();

// Apply middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Log all requests
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// MCP routes
app.use('/mcp', mcpRoutes);

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  
  res.status(500).json({
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32603,
      message: 'Internal server error',
    },
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  logger.warn(`Route not found: ${req.method} ${req.path}`);
  
  res.status(404).json({
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32601,
      message: 'Method not found',
    },
  });
});

export default app;
