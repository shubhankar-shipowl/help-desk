import { prisma } from '../lib/prisma';

async function checkImageSizes() {
  try {
    console.log('[Check] Analyzing email image sizes...');

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
      take: 20,
    });

    console.log(`[Check] Analyzing ${emailsWithDataUris.length} emails`);

    emailsWithDataUris.forEach((email) => {
      const matches = email.htmlContent!.match(
        /data:image\/[^;]+;base64,([A-Za-z0-9+/=]+?)(?:\s|<|$)/g,
      );
      if (matches) {
        matches.forEach((match, idx) => {
          const base64Part = match.split('base64,')[1] || '';
          // Remove trailing space or tag if present
          const cleanBase64 = base64Part
            .replace(/\s.*$/, '')
            .replace(/<.*$/, '');
          console.log(
            `  Email "${email.subject.substring(0, 40)}": Image ${idx + 1} = ${cleanBase64.length} chars (${(cleanBase64.length / 1024).toFixed(1)}KB)`,
          );
        });
      }
    });
  } catch (error) {
    console.error('[Check] Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkImageSizes();
