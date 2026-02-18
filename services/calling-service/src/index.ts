/* eslint-disable @typescript-eslint/no-var-requires */
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ override: true });
/* eslint-enable @typescript-eslint/no-var-requires */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { validateEnv } from './config/env';
import { prisma } from './config/database';
import { errorHandler } from './middleware/error-handler';

import { healthRouter } from './routes/health';
import { callLogsRouter } from './routes/call-logs';
import { callLogsRefreshRouter } from './routes/call-logs-refresh';
import { initiateCallRouter } from './routes/initiate-call';
import { exotelWebhookRouter } from './routes/exotel-webhook';
import { exotelStatusCallbackRouter } from './routes/exotel-status-callback';

validateEnv();

const app = express();
const PORT = process.env.PORT || 4005;

app.use(helmet());
app.use(morgan('[:date[iso]] :method :url :status :response-time ms'));
app.use(cors({
  origin: process.env.APP_URL || 'http://localhost:4002',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Routes
app.use('/health', healthRouter);
app.use('/call-logs', callLogsRouter);
app.use('/call-logs/refresh', callLogsRefreshRouter);
app.use('/calls/initiate', initiateCallRouter);
app.use('/exotel/webhook', exotelWebhookRouter);
app.use('/exotel/status-callback', exotelStatusCallbackRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[Calling Service] Running on port ${PORT}`);
  console.log(`[Calling Service] Health check: http://localhost:${PORT}/health`);
});

async function gracefulShutdown(signal: string) {
  console.log(`[Calling Service] ${signal} received, shutting down...`);
  try {
    await prisma.$disconnect();
    console.log('[Calling Service] Database connections closed');
  } catch (err) {
    console.error('[Calling Service] Error disconnecting database:', err);
  }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
