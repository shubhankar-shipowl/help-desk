import { prisma } from './lib/prisma';

async function check() {
  const email = await prisma.email.findFirst({
    where: { subject: { contains: 'subject for testing only' } },
    select: { htmlContent: true },
  });

  if (email?.htmlContent) {
    const html = email.htmlContent;
    console.log('Total HTML length:', html.length, 'chars');
    console.log('HTML includes <img:', html.includes('<img'));

    // Find the img tag more carefully
    const imgIdx = html.indexOf('<img');
    console.log('Found <img at index:', imgIdx);

    if (imgIdx >= 0) {
      // Look for the closing > after src=
      const afterImg = html.substring(imgIdx);
      const srcIdx = afterImg.indexOf('src=');

      if (srcIdx >= 0) {
        // Find opening quote
        const quoteStart = afterImg.indexOf('"', srcIdx);
        let quoteEnd = -1;

        if (quoteStart >= 0) {
          // Find closing quote
          quoteEnd = afterImg.indexOf('"', quoteStart + 1);

          if (quoteEnd >= 0) {
            const srcValue = afterImg.substring(quoteStart + 1, quoteEnd);
            console.log('\n✅ Found src attribute');
            console.log('Src value length:', srcValue.length);
            console.log('First 100 chars:', srcValue.substring(0, 100));
            console.log(
              'Last 100 chars:',
              srcValue.substring(Math.max(0, srcValue.length - 100)),
            );

            if (srcValue.includes('base64,')) {
              const b64Start = srcValue.indexOf('base64,') + 7;
              const b64Data = srcValue.substring(b64Start);
              console.log('\nBase64 data:');
              console.log('Length:', b64Data.length);
              console.log('First 50:', b64Data.substring(0, 50));
              console.log(
                'Last 50:',
                b64Data.substring(Math.max(0, b64Data.length - 50)),
              );
            }
          } else {
            console.log('❌ No closing quote found after src');
          }
        } else {
          console.log('❌ No opening quote found for src');
        }
      } else {
        console.log('❌ No src= attribute found in img tag');
      }

      // Now find the closing > of the img tag
      const tagEndIdx = afterImg.indexOf('>', srcIdx + 50); // Search past src value
      if (tagEndIdx >= 0) {
        const completeTag = afterImg.substring(0, tagEndIdx + 1);
        console.log('\n✅ Found complete img tag');
        console.log('Tag length:', completeTag.length);
      } else {
        console.log('\n❌ Could not find closing > for img tag');
      }
    } else {
      console.log('❌ <img tag not found');
    }
  }

  await prisma.$disconnect();
}

check();
