import { Router } from 'express';
import McpController from '../controllers/mcp-controller';
import { authenticate } from '../middleware/auth';

const router = Router();
const mcpController = new McpController();

// MCP endpoint
router.post('/', authenticate, (req, res) => mcpController.handleRequest(req, res));

export default router;
