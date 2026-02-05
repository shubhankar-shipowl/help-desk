import { prisma } from './lib/prisma';

/**
 * Debug script to analyze email content storage and image tags
 * Run with: npx tsx debug-email-content.ts <search-term>
 * Search term can be: email subject, messageId, or database ID
 */

async function debugEmail(searchTerm: string) {
  console.log('\n' + '='.repeat(80));
  console.log(`📧 [DEBUG] Searching for email: ${searchTerm}`);
  console.log('='.repeat(80));

  try {
    // Try to find email by ID, messageId, or subject
    const email = await prisma.email.findFirst({
      where: {
        OR: [
          { id: searchTerm },
          { messageId: searchTerm },
          { subject: { contains: searchTerm } },
        ],
      },
      select: {
        id: true,
        messageId: true,
        subject: true,
        fromEmail: true,
        htmlContent: true,
        textContent: true,
        hasAttachments: true,
        EmailAttachment: {
          select: {
            id: true,
            filename: true,
            mimeType: true,
            size: true,
            fileUrl: true,
          },
        },
      },
    });

    if (!email) {
      console.error(`❌ Email not found for search term: ${searchTerm}`);
      console.log('\n📌 Try using:');
      console.log('   - Email subject (partial match)');
      console.log('   - Email message ID');
      console.log('   - Database email ID (UUID)');

      // Show available emails
      console.log('\n📧 Available emails:');
      const recentEmails = await prisma.email.findMany({
        select: {
          id: true,
          subject: true,
          fromEmail: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      recentEmails.forEach((e) => {
        console.log(`   ID: ${e.id}`);
        console.log(`   Subject: ${e.subject}`);
        console.log(`   From: ${e.fromEmail}`);
        console.log(`   Date: ${e.createdAt}`);
        console.log('');
      });

      process.exit(1);
    }

    // Basic info
    console.log('\n📋 [Email Info]');
    console.log(`   Subject: ${email.subject}`);
    console.log(`   From: ${email.fromEmail}`);
    console.log(`   Message ID: ${email.messageId}`);
    console.log(`   Database ID: ${email.id}`);
    console.log(`   Has Attachments: ${email.hasAttachments}`);

    // HTML Content Analysis
    console.log('\n📝 [HTML Content Analysis]');
    if (!email.htmlContent) {
      console.log('   ❌ NO HTML CONTENT - Email only has text');
      console.log(
        `   Text Content Length: ${email.textContent?.length || 0} chars`,
      );
      console.log(
        `   Text Preview: ${email.textContent?.substring(0, 200)}...`,
      );
      process.exit(1);
    }

    console.log(`   ✅ HTML Content Length: ${email.htmlContent.length} chars`);

    // First check if <img exists anywhere
    const hasImgTag = email.htmlContent.includes('<img');
    console.log(`   Contains "<img": ${hasImgTag ? '✅ Yes' : '❌ No'}`);

    // Show first 1500 chars to see full img tag
    console.log(`\n   📄 First 1500 chars of HTML:`);
    console.log(`   ${email.htmlContent.substring(0, 1500)}`);
    console.log(`   ...\n`);

    // Check for image tags
    const imgRegex = /<img[^>]*>/gi;
    const imgMatches = email.htmlContent.match(imgRegex) || [];
    console.log(`   📸 Image Tags Found by Regex: ${imgMatches.length}`);

    if (imgMatches.length === 0) {
      // Try alternative regex patterns
      console.log('\n   🔍 Trying alternative patterns...');

      // Just find all <img variants
      const imgAnyRegex = /<img[^>]*(?:>|$)/gi;
      const imgAnyMatches = email.htmlContent.match(imgAnyRegex) || [];
      console.log(
        `   Pattern 1 (<img[^>]*(?:>|$)): ${imgAnyMatches.length} matches`,
      );

      // Find img with src
      const imgWithSrcRegex = /<img[^>]+src=/gi;
      const imgWithSrcMatches = email.htmlContent.match(imgWithSrcRegex) || [];
      console.log(
        `   Pattern 2 (<img[^>]+src=): ${imgWithSrcMatches.length} matches`,
      );

      if (imgWithSrcMatches.length > 0) {
        console.log(
          `   ✅ Found ${imgWithSrcMatches.length} img tags with src attribute`,
        );
      } else {
        console.log(
          '   ❌ NO IMAGE TAGS in HTML - email not processed correctly!',
        );
        process.exit(1);
      }
    }

    // Analyze each image tag
    console.log('\n🔍 [Image Tag Analysis]');
    imgMatches.forEach((imgTag, idx) => {
      console.log(`\n   Image ${idx + 1}:`);
      console.log(`   Tag: ${imgTag.substring(0, 150)}...`);

      // Extract src attribute
      const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
      if (!srcMatch) {
        console.log('   ❌ NO SRC ATTRIBUTE');
        return;
      }

      const src = srcMatch[1];
      console.log(`   Src Length: ${src.length} chars`);

      // Check source type
      if (src.startsWith('data:')) {
        const mimeMatch = src.match(/data:([^;]+)/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'unknown';
        console.log(`   ✅ Data URI - MIME: ${mimeType}`);

        // Check if base64 is valid
        const b64Match = src.match(/base64,(.+)$/);
        if (b64Match) {
          const b64Data = b64Match[1];
          console.log(`   Base64 Length: ${b64Data.length} chars`);

          // Try to decode a sample
          try {
            const sample = b64Data.substring(0, 100);
            Buffer.from(sample, 'base64');
            console.log(
              `   ✅ Base64 appears valid (sample decoded successfully)`,
            );
          } catch (e) {
            console.log(`   ❌ Base64 INVALID: ${(e as Error).message}`);
          }
        } else {
          console.log('   ❌ Not base64 encoded');
        }
      } else if (src.includes('/api/storage/mega/')) {
        console.log(`   ✅ Mega URL: ${src.substring(0, 100)}...`);
      } else if (src.startsWith('http')) {
        console.log(`   ✅ External URL: ${src.substring(0, 100)}...`);
      } else if (src.startsWith('cid:')) {
        console.log(`   ℹ️  CID Reference: ${src}`);
      } else {
        console.log(`   ⚠️  Unknown source type: ${src.substring(0, 100)}...`);
      }
    });

    // Check for video tags
    const videoRegex = /<video[^>]*>/gi;
    const videoMatches = email.htmlContent.match(videoRegex) || [];
    console.log(`\n   🎬 Video Tags Found: ${videoMatches.length}`);

    // Check attachments
    console.log('\n📎 [Attachments]');
    if (email.EmailAttachment.length === 0) {
      console.log('   No attachments');
    } else {
      email.EmailAttachment.forEach((att, idx) => {
        console.log(`   ${idx + 1}. ${att.filename}`);
        console.log(`      MIME: ${att.mimeType}`);
        console.log(`      Size: ${att.size} bytes`);
        console.log(`      URL: ${att.fileUrl ? '✅ Present' : '❌ Missing'}`);
      });
    }

    // Check for common issues
    console.log('\n⚠️  [Common Issues Check]');

    if (email.htmlContent.includes('[Content truncated]')) {
      console.log('   ❌ HTML WAS TRUNCATED - Images may be cut off!');
    } else {
      console.log('   ✅ HTML NOT truncated');
    }

    // Check if HTML is just plain text wrapped in tags
    if (email.htmlContent.length < 500 && imgMatches.length === 0) {
      console.log(
        '   ⚠️  Very small HTML with no images - might be plain text email',
      );
    }

    // Check for valid img tag structure
    const validImgRegex = /<img[^>]+src=["'][^"']+["'][^>]*>/gi;
    const validImgMatches = email.htmlContent.match(validImgRegex) || [];
    if (validImgMatches.length !== imgMatches.length) {
      console.log(
        `   ⚠️  Some image tags may be malformed (found ${imgMatches.length}, valid: ${validImgMatches.length})`,
      );
    } else {
      console.log(`   ✅ All image tags are properly formed`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('Summary: Check the above for any ❌ markers');
    console.log('='.repeat(80) + '\n');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Get search term from command line
const searchTerm = process.argv[2];
if (!searchTerm) {
  console.error('❌ Usage: npx tsx debug-email-content.ts <search-term>');
  console.error(
    '   Search term can be: email subject, messageId, or database ID',
  );
  process.exit(1);
}

debugEmail(searchTerm).catch(console.error);
