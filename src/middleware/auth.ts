import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import logger from '../utils/logger';
import { McpErrorCodes } from '../types/mcp';

// Interface for JWT payload
export interface JwtPayload {
  userId: string;
  name: string;
  iat: number;
  exp: number;
}

// Extend Express Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Middleware to authenticate requests using JWT
 */
export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  // Skip authentication for the health check endpoint
  if (req.path === '/health') {
    return next();
  }

  // Get token from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Authentication failed: No token provided');
    return res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: McpErrorCodes.UNAUTHORIZED,
        message: 'Authentication required',
      },
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    req.user = decoded;
    next();
  } catch (error) {
    logger.warn(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: McpErrorCodes.UNAUTHORIZED,
        message: 'Invalid or expired token',
      },
    });
  }
};

/**
 * Generate a JWT token for a user
 */
export const generateToken = (userId: string, name: string): string => {
  return jwt.sign(
    { userId, name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
};

/**
 * Verify a JWT token and return the payload
 */
export const verifyToken = (token: string): JwtPayload | null => {
  try {
    return jwt.verify(token, config.jwt.secret) as JwtPayload;
  } catch (error) {
    logger.warn(`Token verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return null;
  }
};
