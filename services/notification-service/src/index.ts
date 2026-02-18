/* eslint-disable @typescript-eslint/no-var-requires */
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ override: true });
/* eslint-enable @typescript-eslint/no-var-requires */

import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { validateEnv } from './config/env';
import { prisma } from './config/database';
import { errorHandler } from './middleware/error-handler';
import { initializeWebSocket } from './services/websocket';

// Route imports
import { healthRouter } from './routes/health';
import { notificationsRouter } from './routes/notifications';
import { notificationByIdRouter } from './routes/notification-by-id';
import { markAllReadRouter } from './routes/mark-all-read';
import { unreadCountRouter } from './routes/unread-count';
import { preferencesRouter } from './routes/preferences';
import { pushSubscribeRouter } from './routes/push-subscribe';
import { triggersRouter } from './routes/triggers';

// Initialize workers (they self-start on import)
import './services/email-worker';
import './services/push-worker';

// Validate environment variables
validateEnv();

const app = express();
const PORT = process.env.PORT || 4004;

// Middleware
app.use(helmet());
app.use(morgan('[:date[iso]] :method :url :status :response-time ms'));
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.APP_URL || 'http://localhost:4002')
    : true, // Allow all origins in development
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Routes
app.use('/health', healthRouter);
app.use('/notifications', notificationsRouter);
app.use('/notifications', notificationByIdRouter);       // handles /:id
app.use('/notifications/mark-all-read', markAllReadRouter);
app.use('/notifications/unread-count', unreadCountRouter);
app.use('/notifications/preferences', preferencesRouter);
app.use('/notifications/push', pushSubscribeRouter);
app.use('/internal', triggersRouter);

// Error handling
app.use(errorHandler);

// Create HTTP server and attach Socket.IO
const server = createServer(app);
initializeWebSocket(server);

server.listen(PORT, () => {
  console.log(`[Notification Service] Running on port ${PORT}`);
  console.log(`[Notification Service] WebSocket server initialized`);
  console.log(`[Notification Service] Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown - disconnect DB first, then close server
async function gracefulShutdown(signal: string) {
  console.log(`[Notification Service] ${signal} received, shutting down...`);
  try {
    await prisma.$disconnect();
    console.log('[Notification Service] Database connections closed');
  } catch (err) {
    console.error('[Notification Service] Error disconnecting database:', err);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
