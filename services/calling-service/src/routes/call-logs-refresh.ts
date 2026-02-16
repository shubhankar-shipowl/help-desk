import { Router, Request, Response } from 'express';
import { authMiddleware, requireAgentOrAdmin } from '../middleware/auth';
import { prisma } from '../config/database';
import axios from 'axios';
import { mapExotelStatus } from '../services/exotel-service';
import { uploadCallRecordingToMega } from '../services/mega-storage';

const router = Router();

// POST /call-logs/refresh
router.post('/', authMiddleware, requireAgentOrAdmin, async (req: Request, res: Response) => {
  try {
    const { callLogId, refreshAll, uploadRecordings } = req.body;

    const exotelSid = process.env.EXOTEL_SID;
    const apiKey = process.env.EXOTEL_KEY;
    const apiToken = process.env.EXOTEL_TOKEN;

    if (!exotelSid || !apiKey || !apiToken) {
      res.status(500).json({ error: 'Exotel configuration missing' });
      return;
    }

    let callLogs;

    if (uploadRecordings) {
      callLogs = await prisma.callLog.findMany({
        where: {
          exotelCallId: { not: null },
          recordingUrl: {
            not: null,
            startsWith: 'http',
          },
        },
        take: 50,
        orderBy: { startedAt: 'desc' },
      });
    } else if (refreshAll) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      callLogs = await prisma.callLog.findMany({
        where: {
          status: 'INITIATED',
          exotelCallId: { not: null },
          startedAt: { lt: oneHourAgo },
        },
        take: 50,
      });
    } else if (callLogId) {
      const callLog = await prisma.callLog.findUnique({
        where: { id: callLogId },
      });
      if (!callLog) {
        res.status(404).json({ error: 'Call log not found' });
        return;
      }
      callLogs = [callLog];
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const initiatedCalls = await prisma.callLog.findMany({
        where: {
          status: 'INITIATED',
          exotelCallId: { not: null },
          startedAt: { gte: today },
        },
      });

      const callsNeedingRecordingUpload = await prisma.callLog.findMany({
        where: {
          exotelCallId: { not: null },
          recordingUrl: {
            not: null,
            startsWith: 'http',
          },
          startedAt: { gte: today },
        },
        take: 20,
      });

      const allCalls = [...initiatedCalls, ...callsNeedingRecordingUpload];
      const seenIds = new Set<string>();
      callLogs = allCalls.filter(call => {
        if (seenIds.has(call.id)) return false;
        seenIds.add(call.id);
        return true;
      });
    }

    console.log(`[Call Refresh] Refreshing ${callLogs.length} call(s)`);

    const results = {
      total: callLogs.length,
      updated: 0,
      failed: 0,
      details: [] as any[],
    };

    for (const callLog of callLogs) {
      if (!callLog.exotelCallId) {
        results.failed++;
        results.details.push({
          id: callLog.id,
          error: 'No Exotel Call ID',
        });
        continue;
      }

      try {
        // Fast path: upload recordings mode
        if (uploadRecordings && callLog.recordingUrl && callLog.recordingUrl.startsWith('http')) {
          console.log(`[Call Refresh] Fast upload for: ${callLog.exotelCallId}`);
          try {
            const megaResult = await uploadCallRecordingToMega(
              callLog.recordingUrl,
              callLog.exotelCallId,
              { apiKey, apiToken }
            );
            if (megaResult) {
              await prisma.callLog.update({
                where: { id: callLog.id },
                data: {
                  recordingUrl: megaResult.fileUrl,
                  updatedAt: new Date(),
                },
              });
              console.log(`[Call Refresh] Recording uploaded to Mega: ${megaResult.fileUrl}`);
              results.updated++;
              results.details.push({
                id: callLog.id,
                exotelCallId: callLog.exotelCallId,
                recordingUploaded: true,
                newUrl: megaResult.fileUrl,
              });
            } else {
              results.failed++;
              results.details.push({
                id: callLog.id,
                error: 'Failed to upload recording',
              });
            }
          } catch (uploadError: any) {
            console.error(`[Call Refresh] Upload error:`, uploadError.message);
            results.failed++;
            results.details.push({
              id: callLog.id,
              error: uploadError.message,
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }

        // Fetch call details from Exotel API
        const apiUrl = `https://${apiKey}:${apiToken}@api.exotel.com/v1/Accounts/${exotelSid}/Calls/${callLog.exotelCallId}.json`;

        console.log(`[Call Refresh] Fetching: ${callLog.exotelCallId}`);

        const response = await axios.get(apiUrl, { timeout: 10000 });

        if (response.data && response.data.Call) {
          const callData = response.data.Call;

          const status = mapExotelStatus(callData.Status, callData.Status);

          let duration = 0;
          if (callData.ConversationDuration) {
            duration = parseInt(callData.ConversationDuration) || 0;
          } else if (callData.Duration) {
            duration = parseInt(callData.Duration) || 0;
          } else if (callData.StartTime && callData.EndTime) {
            const startTime = new Date(callData.StartTime);
            const endTime = new Date(callData.EndTime);
            if (!isNaN(startTime.getTime()) && !isNaN(endTime.getTime())) {
              duration = Math.floor(
                (endTime.getTime() - startTime.getTime()) / 1000,
              );
            }
          }

          let endedAt = callLog.endedAt;
          if (callData.EndTime) {
            endedAt = new Date(callData.EndTime);
          } else if (
            status !== 'INITIATED' &&
            status !== 'RINGING' &&
            status !== 'ANSWERED'
          ) {
            endedAt = new Date();
          }

          let recordingUrl = callData.RecordingUrl || callData.RecordingURL || null;

          if (!recordingUrl && callData.Recordings && callData.Recordings.length > 0) {
            recordingUrl = callData.Recordings[0].Uri || callData.Recordings[0].Url || null;
          }

          if (!recordingUrl && callLog.recordingUrl && callLog.recordingUrl.startsWith('http')) {
            recordingUrl = callLog.recordingUrl;
          }

          let localRecordingUrl = recordingUrl;
          if (recordingUrl && !recordingUrl.startsWith('/api/storage/mega/')) {
            try {
              const megaResult = await uploadCallRecordingToMega(
                recordingUrl,
                callLog.exotelCallId!,
                { apiKey, apiToken }
              );
              if (megaResult) {
                localRecordingUrl = megaResult.fileUrl;
              }
            } catch (megaError: any) {
              console.error(`[Call Refresh] Failed to upload recording to Mega:`, megaError.message);
            }
          }

          await prisma.callLog.update({
            where: { id: callLog.id },
            data: {
              status: status,
              duration: duration,
              endedAt: endedAt,
              recordingUrl: localRecordingUrl,
              exotelResponse: callData,
              remark: callData.Status || callData.Outcome || null,
              updatedAt: new Date(),
            },
          });

          console.log(`[Call Refresh] Updated ${callLog.id}: ${status}, ${duration}s`);

          results.updated++;
          results.details.push({
            id: callLog.id,
            exotelCallId: callLog.exotelCallId,
            oldStatus: callLog.status,
            newStatus: status,
            duration: duration,
          });
        } else {
          results.failed++;
          results.details.push({
            id: callLog.id,
            error: 'No call data in response',
          });
        }
      } catch (error: any) {
        console.error(`[Call Refresh] Error for ${callLog.id}:`, error.message);
        results.failed++;
        results.details.push({
          id: callLog.id,
          error: error.message,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log(`[Call Refresh] Complete: ${results.updated} updated, ${results.failed} failed`);

    res.json({
      success: true,
      ...results,
    });
  } catch (error: any) {
    console.error('[Call Refresh] Error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to refresh call logs' });
  }
});

export { router as callLogsRefreshRouter };
