/**
 * Script to manually refresh call statuses from Exotel API
 * Run with: npx ts-node scripts/refresh-call-status.ts
 */

import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const prisma = new PrismaClient();

// Map Exotel status to internal status
function mapExotelStatus(exotelStatus?: string): string {
  const statusMap: Record<string, string> = {
    completed: 'COMPLETED',
    'no-answer': 'NO_ANSWER',
    no_answer: 'NO_ANSWER',
    busy: 'BUSY',
    failed: 'FAILED',
    canceled: 'CANCELLED',
    cancelled: 'CANCELLED',
    ringing: 'RINGING',
    answered: 'ANSWERED',
    'in-progress': 'ANSWERED',
  };
  const status = (exotelStatus || '').toLowerCase();
  return statusMap[status] || 'FAILED';
}

async function main() {
  const exotelSid = process.env.EXOTEL_SID;
  const apiKey = process.env.EXOTEL_KEY;
  const apiToken = process.env.EXOTEL_TOKEN;

  if (!exotelSid || !apiKey || !apiToken) {
    console.log('Missing Exotel credentials in environment');
    console.log('Required: EXOTEL_SID, EXOTEL_KEY, EXOTEL_TOKEN');
    return;
  }

  // Get initiated calls
  const callLogs = await prisma.callLog.findMany({
    where: { status: 'INITIATED' },
    take: 10,
    orderBy: { startedAt: 'desc' },
  });

  console.log(`Found ${callLogs.length} INITIATED calls to refresh`);

  let updated = 0;
  let failed = 0;

  for (const callLog of callLogs) {
    if (!callLog.exotelCallId) {
      console.log(`\nSkipping ${callLog.id}: No Exotel Call ID`);
      continue;
    }

    try {
      const apiUrl = `https://${apiKey}:${apiToken}@api.exotel.com/v1/Accounts/${exotelSid}/Calls/${callLog.exotelCallId}.json`;

      console.log(`\nFetching: ${callLog.exotelCallId}`);

      const response = await axios.get(apiUrl, { timeout: 10000 });

      if (response.data && response.data.Call) {
        const callData = response.data.Call;
        const status = mapExotelStatus(callData.Status);
        let duration =
          parseInt(callData.ConversationDuration) ||
          parseInt(callData.Duration) ||
          0;

        // Get recording URL
        let recordingUrl = callData.RecordingUrl || callData.RecordingURL || null;
        if (!recordingUrl && callData.Recordings && callData.Recordings.length > 0) {
          recordingUrl = callData.Recordings[0].Uri || callData.Recordings[0].Url || null;
        }

        console.log(`  Exotel Status: ${callData.Status}`);
        console.log(`  Mapped Status: ${status}`);
        console.log(`  Duration: ${duration}s`);
        console.log(`  Recording: ${recordingUrl || 'none'}`);

        // Update
        await prisma.callLog.update({
          where: { id: callLog.id },
          data: {
            status: status as any,
            duration: duration,
            recordingUrl: recordingUrl,
            endedAt: callData.EndTime ? new Date(callData.EndTime) : new Date(),
            remark: callData.Status || null,
            updatedAt: new Date(),
          },
        });

        console.log('  Updated!');
        updated++;
      }
    } catch (error: any) {
      console.error(`  Error: ${error.message}`);
      failed++;
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${failed}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
