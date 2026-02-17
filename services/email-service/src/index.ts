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

// Route imports
import { healthRouter } from './routes/health';
import { emailsRouter } from './routes/emails';
import { emailFetchRouter } from './routes/email-fetch';
import { emailSyncRouter } from './routes/email-sync';
import { emailTestImapRouter } from './routes/email-test-imap';
import { emailDeleteRouter } from './routes/email-delete';
import { emailByIdRouter } from './routes/email-by-id';
import { emailReplyRouter } from './routes/email-reply';
import { emailCreateTicketRouter } from './routes/email-create-ticket';
import { emailProcessImagesRouter } from './routes/email-process-images';
import { emailRepairImagesRouter } from './routes/email-repair-images';

// Validate environment variables
validateEnv();

const app = express();
const PORT = process.env.PORT || 4003;

// Middleware
app.use(helmet());
app.use(morgan('[:date[iso]] :method :url :status :response-time ms'));
app.use(cors({
  origin: process.env.MONOLITH_URL || 'http://localhost:4002',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Routes
app.use('/health', healthRouter);
app.use('/emails', emailsRouter);
app.use('/emails/fetch', emailFetchRouter);
app.use('/emails/sync', emailSyncRouter);
app.use('/emails/test-imap', emailTestImapRouter);
app.use('/emails/delete', emailDeleteRouter);
app.use('/emails', emailByIdRouter); // handles /:id
app.use('/emails', emailReplyRouter); // handles /:id/reply
app.use('/emails', emailCreateTicketRouter); // handles /:id/create-ticket
app.use('/emails', emailProcessImagesRouter); // handles /:id/process-images
app.use('/emails', emailRepairImagesRouter); // handles /:id/repair-images

// Error handling
app.use(errorHandler);

// Start server
const server = app.listen(PORT, () => {
  console.log(`[Email Service] Running on port ${PORT}`);
  console.log(`[Email Service] Health check: http://localhost:${PORT}/health`);
});

// Prevent premature connection close on long-running IMAP operations
// Default keepAliveTimeout (5s) causes ECONNRESET when proxy reuses connections
server.keepAliveTimeout = 120000; // 2 minutes
server.headersTimeout = 125000;   // Must be higher than keepAliveTimeout
server.timeout = 180000;          // 3 minutes max for any request

// Prevent process crashes from unhandled errors (e.g. IMAP connection issues)
process.on('uncaughtException', (error) => {
  console.error('[Email Service] Uncaught exception:', error.message);
  console.error(error.stack);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('[Email Service] Unhandled rejection:', reason?.message || reason);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Email Service] SIGTERM received, shutting down...');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('[Email Service] SIGINT received, shutting down...');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
});

export default app;
