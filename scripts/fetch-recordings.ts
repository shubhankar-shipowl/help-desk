/**
 * Fetch recording URLs for completed calls
 */

import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const prisma = new PrismaClient();

async function main() {
  const exotelSid = process.env.EXOTEL_SID;
  const apiKey = process.env.EXOTEL_KEY;
  const apiToken = process.env.EXOTEL_TOKEN;

  if (!exotelSid || !apiKey || !apiToken) {
    console.log('Missing Exotel credentials');
    return;
  }

  // Get COMPLETED calls without recording URL
  const callLogs = await prisma.callLog.findMany({
    where: {
      status: 'COMPLETED',
      duration: { gt: 0 },
      recordingUrl: null,
      exotelCallId: { not: null },
    },
    take: 20,
    orderBy: { startedAt: 'desc' },
  });

  console.log(`Found ${callLogs.length} calls to update`);

  let updated = 0;

  for (const callLog of callLogs) {
    if (!callLog.exotelCallId) continue;

    try {
      const apiUrl = `https://${apiKey}:${apiToken}@api.exotel.com/v1/Accounts/${exotelSid}/Calls/${callLog.exotelCallId}.json`;
      const response = await axios.get(apiUrl, { timeout: 10000 });

      if (response.data && response.data.Call) {
        const callData = response.data.Call;

        // Try to get recording URL from various fields
        let recordingUrl =
          callData.RecordingUrl || callData.RecordingURL || null;

        if (
          !recordingUrl &&
          callData.Recordings &&
          callData.Recordings.length > 0
        ) {
          recordingUrl =
            callData.Recordings[0].Uri || callData.Recordings[0].Url || null;
        }

        // Check in SubResource if available
        if (!recordingUrl && callData.SubResourceUris) {
          console.log(`  SubResourceUris:`, callData.SubResourceUris);
        }

        if (recordingUrl) {
          await prisma.callLog.update({
            where: { id: callLog.id },
            data: { recordingUrl: recordingUrl, updatedAt: new Date() },
          });
          console.log(`✅ ${callLog.exotelCallId} -> ${recordingUrl}`);
          updated++;
        } else {
          console.log(`⚠️  ${callLog.exotelCallId} - No recording found`);
          // Log full response for debugging
          console.log('   Response keys:', Object.keys(callData));
        }
      }
    } catch (error: any) {
      console.error(`❌ ${callLog.exotelCallId}: ${error.message}`);
    }
  }

  console.log(`\nUpdated ${updated} call logs with recording URLs`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
