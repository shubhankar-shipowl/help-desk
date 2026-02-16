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
import { webhookRouter } from './routes/webhook';
import { connectRouter } from './routes/connect';
import { callbackRouter } from './routes/callback';
import { disconnectRouter } from './routes/disconnect';
import { integrationRouter } from './routes/integration';
import { integrationSettingsRouter } from './routes/integration-settings';
import { integrationDisconnectRouter } from './routes/integration-disconnect';
import { convertTicketRouter } from './routes/convert-ticket';
import { configRouter } from './routes/config';

validateEnv();

const app = express();
const PORT = process.env.PORT || 3006;

app.use(helmet());
app.use(morgan('[:date[iso]] :method :url :status :response-time ms'));
app.use(cors({
  origin: process.env.APP_URL || 'http://localhost:3002',
  credentials: true,
}));
// Capture raw body for webhook signature validation
app.use(express.json({
  limit: '10mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Routes
app.use('/health', healthRouter);
app.use('/webhooks/facebook', webhookRouter);
app.use('/facebook/connect', connectRouter);
app.use('/facebook/callback', callbackRouter);
app.use('/facebook/disconnect', disconnectRouter);
app.use('/facebook/integration/settings', integrationSettingsRouter);
app.use('/facebook/integration/disconnect', integrationDisconnectRouter);
app.use('/facebook/integration', integrationRouter);
app.use('/facebook/convert-ticket', convertTicketRouter);
app.use('/facebook/config', configRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[Facebook Service] Running on port ${PORT}`);
  console.log(`[Facebook Service] Health check: http://localhost:${PORT}/health`);
});

process.on('SIGTERM', async () => {
  console.log('[Facebook Service] SIGTERM received, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Facebook Service] SIGINT received, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

export default app;
