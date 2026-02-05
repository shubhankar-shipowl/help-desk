import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import axios from 'axios';
import { mapExotelStatus } from '@/lib/exotel-call-service';
import { uploadCallRecordingToMega } from '@/lib/storage/mega';

export const dynamic = 'force-dynamic';

/**
 * Refresh call log status from Exotel API
 * This is useful when webhooks aren't working or need manual update
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (
      !session ||
      (session.user.role !== 'AGENT' && session.user.role !== 'ADMIN')
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { callLogId, refreshAll, uploadRecordings } = body;

    // Get Exotel config
    const exotelSid = process.env.EXOTEL_SID;
    const apiKey = process.env.EXOTEL_KEY;
    const apiToken = process.env.EXOTEL_TOKEN;

    if (!exotelSid || !apiKey || !apiToken) {
      return NextResponse.json(
        { error: 'Exotel configuration missing' },
        { status: 500 },
      );
    }

    let callLogs;

    if (uploadRecordings) {
      // Find all calls that have Exotel recording URLs (not yet uploaded to Mega)
      // This includes COMPLETED calls that need their recordings migrated
      callLogs = await prisma.callLog.findMany({
        where: {
          exotelCallId: { not: null },
          recordingUrl: {
            not: null,
            startsWith: 'http', // Exotel URLs start with http, Mega URLs start with /api
          },
        },
        take: 50, // Limit to prevent too many API calls
        orderBy: { startedAt: 'desc' },
      });
    } else if (refreshAll) {
      // Refresh all INITIATED calls that haven't been updated in the last hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      callLogs = await prisma.callLog.findMany({
        where: {
          status: 'INITIATED',
          exotelCallId: { not: null },
          startedAt: { lt: oneHourAgo },
        },
        take: 50, // Limit to prevent too many API calls
      });
    } else if (callLogId) {
      // Refresh specific call log
      const callLog = await prisma.callLog.findUnique({
        where: { id: callLogId },
      });
      if (!callLog) {
        return NextResponse.json(
          { error: 'Call log not found' },
          { status: 404 },
        );
      }
      callLogs = [callLog];
    } else {
      // Default: refresh INITIATED calls from today + calls with Exotel recording URLs
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Get initiated calls
      const initiatedCalls = await prisma.callLog.findMany({
        where: {
          status: 'INITIATED',
          exotelCallId: { not: null },
          startedAt: { gte: today },
        },
      });

      // Also get calls with Exotel recording URLs that need migration
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

      // Combine and dedupe
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
        // Fast path: If uploadRecordings mode and we already have an Exotel recording URL,
        // skip the API call and just upload directly to Mega
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
          // Small delay between uploads
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }

        // Fetch call details from Exotel API
        const apiUrl = `https://${apiKey}:${apiToken}@api.exotel.com/v1/Accounts/${exotelSid}/Calls/${callLog.exotelCallId}.json`;

        console.log(`[Call Refresh] Fetching: ${callLog.exotelCallId}`);

        const response = await axios.get(apiUrl, { timeout: 10000 });

        if (response.data && response.data.Call) {
          const callData = response.data.Call;

          // Get status
          const status = mapExotelStatus(callData.Status, callData.Status);

          // Get duration - try multiple fields
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

          // Get end time
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

          // Get recording URL - Exotel provides this for recorded calls
          let recordingUrl = callData.RecordingUrl || callData.RecordingURL || null;

          // If no direct recording URL, try to construct from recordings array
          if (!recordingUrl && callData.Recordings && callData.Recordings.length > 0) {
            recordingUrl = callData.Recordings[0].Uri || callData.Recordings[0].Url || null;
          }

          // If still no recording URL from API but we have one in database (Exotel URL), use that
          if (!recordingUrl && callLog.recordingUrl && callLog.recordingUrl.startsWith('http')) {
            recordingUrl = callLog.recordingUrl;
            console.log(`[Call Refresh] Using existing database recording URL`);
          }

          console.log(`[Call Refresh] Recording URL: ${recordingUrl || 'none'}`);

          // If we have a recording URL and it's not already a local URL, upload to Mega
          let localRecordingUrl = recordingUrl;
          if (recordingUrl && !recordingUrl.startsWith('/api/storage/mega/')) {
            try {
              console.log(`[Call Refresh] Uploading recording to Mega for: ${callLog.exotelCallId}`);
              const megaResult = await uploadCallRecordingToMega(
                recordingUrl,
                callLog.exotelCallId!,
                { apiKey, apiToken }
              );
              if (megaResult) {
                localRecordingUrl = megaResult.fileUrl;
                console.log(`[Call Refresh] Recording uploaded to Mega: ${localRecordingUrl}`);
              }
            } catch (megaError: any) {
              console.error(`[Call Refresh] Failed to upload recording to Mega:`, megaError.message);
              // Keep the original Exotel URL as fallback
            }
          }

          // Update call log with local recording URL
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

      // Small delay between API calls to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log(`[Call Refresh] Complete: ${results.updated} updated, ${results.failed} failed`);

    return NextResponse.json({
      success: true,
      ...results,
    });
  } catch (error: any) {
    console.error('[Call Refresh] Error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to refresh call logs' },
      { status: 500 },
    );
  }
}
