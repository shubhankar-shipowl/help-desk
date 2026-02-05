import { prisma } from '../lib/prisma';

/**
 * Delete emails with incomplete/truncated base64 data
 * This allows them to be re-fetched from Gmail with the new non-truncating backend
 */
async function deleteTruncatedEmails() {
  try {
    console.log('[Cleanup] Deleting emails with truncated images...');

    // Find all emails that have data: URIs but the HTML seems truncated
    const emailsWithDataUris = await prisma.email.findMany({
      where: {
        htmlContent: {
          contains: 'data:image/',
        },
      },
      select: {
        id: true,
        subject: true,
        htmlContent: true,
      },
    });

    console.log(
      `[Cleanup] Found ${emailsWithDataUris.length} emails with data URIs`,
    );

    let deletedCount = 0;

    for (const email of emailsWithDataUris) {
      // Extract the last data URI's base64 length
      const lastDataUriMatch = email.htmlContent!.match(
        /data:image\/[^;]+;base64,([A-Za-z0-9+/=]+?)(?:\s|<|$)/,
      );
      if (lastDataUriMatch) {
        const base64Length = lastDataUriMatch[1].length;
        // If base64 is less than 10KB, it's likely truncated (normal images are 50KB+)
        if (base64Length < 10000) {
          console.log(
            `[Cleanup] Deleting email "${email.subject}" (base64 length: ${base64Length} chars)`,
          );

          // Delete email attachments first
          await prisma.emailAttachment.deleteMany({
            where: { emailId: email.id },
          });

          // Delete the email
          await prisma.email.delete({
            where: { id: email.id },
          });

          deletedCount++;
        }
      }
    }

    console.log(
      `[Cleanup] ✅ Deleted ${deletedCount} emails with truncated images`,
    );
    console.log('[Cleanup] These will be re-fetched from Gmail automatically');
  } catch (error) {
    console.error('[Cleanup] Fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

deleteTruncatedEmails();
