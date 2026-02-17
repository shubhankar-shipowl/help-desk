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
import { uploadRouter } from './routes/upload';
import { lookupRouter } from './routes/lookup';
import { vendorsRouter } from './routes/vendors';
import { deleteRouter } from './routes/delete';

validateEnv();

const app = express();
const PORT = process.env.PORT || 4007;

app.use(helmet());
app.use(morgan('[:date[iso]] :method :url :status :response-time ms'));
app.use(cors({
  origin: process.env.APP_URL || 'http://localhost:4002',
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Routes
app.use('/health', healthRouter);
app.use('/order-tracking/upload', uploadRouter);
app.use('/order-tracking/lookup', lookupRouter);
app.use('/order-tracking/vendors', vendorsRouter);
app.use('/order-tracking/delete', deleteRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[Order Tracking Service] Running on port ${PORT}`);
  console.log(`[Order Tracking Service] Health check: http://localhost:${PORT}/health`);
});

process.on('SIGTERM', async () => {
  console.log('[Order Tracking Service] SIGTERM received, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Order Tracking Service] SIGINT received, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

export default app;
