import { prisma } from './lib/prisma';

async function check() {
  const email = await prisma.email.findFirst({
    where: { subject: { contains: 'subject testing' } },
    select: { htmlContent: true },
  });

  if (email?.htmlContent) {
    const idx = email.htmlContent.indexOf('<img');
    const closeIdx = email.htmlContent.indexOf('>', idx) + 1;
    const imgTag = email.htmlContent.substring(idx, closeIdx);

    console.log('IMAGE TAG LENGTH:', imgTag.length);
    console.log('First 300 chars:');
    console.log(imgTag.substring(0, 300));
    console.log('\nLast 100 chars:');
    console.log(imgTag.substring(Math.max(0, imgTag.length - 100)));
    console.log('\nTag ends with >:', imgTag.endsWith('>'));

    // Check if there's closing quote
    const srcMatch = imgTag.match(/src="([^"]+)"/);
    if (srcMatch) {
      console.log('\n✅ Has valid src attribute');
      console.log('Src length:', srcMatch[1].length);
      console.log(
        'Src ends with:',
        srcMatch[1].substring(Math.max(0, srcMatch[1].length - 50)),
      );
    } else {
      console.log('\n❌ NO valid src attribute found');
      // Show the problematic part
      const srcStart = imgTag.indexOf('src=');
      if (srcStart >= 0) {
        console.log('\nsrc= area (first 300 chars):');
        console.log(
          imgTag.substring(srcStart, Math.min(srcStart + 300, imgTag.length)),
        );
      }
    }
  }

  await prisma.$disconnect();
}

check();
