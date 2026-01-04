#!/usr/bin/env tsx
/**
 * Script to subscribe Facebook page to 'mention' webhook field
 * This allows receiving notifications when the page is mentioned in other people's posts
 * 
 * Usage: npx tsx scripts/subscribe-facebook-mention.ts
 */

import { prisma } from '../lib/prisma'

async function subscribeToMention() {
  try {
    console.log('🔍 Finding active Facebook integrations...')
    
    const integrations = await prisma.facebookIntegration.findMany({
      where: { isActive: true },
    })

    if (integrations.length === 0) {
      console.error('❌ No active Facebook integrations found!')
      console.log('💡 Please connect a Facebook page first via /admin/integrations')
      process.exit(1)
    }

    console.log(`✅ Found ${integrations.length} active integration(s)\n`)

    for (const integration of integrations) {
      console.log(`📱 Processing page: ${integration.pageName} (${integration.pageId})`)
      
      if (!integration.accessToken) {
        console.error(`❌ No access token found for page ${integration.pageId}`)
        continue
      }

      try {
        // Subscribe to mention field
        const subscribeUrl = `https://graph.facebook.com/v18.0/${integration.pageId}/subscribed_apps?subscribed_fields=mention&access_token=${integration.accessToken}`
        
        console.log(`📡 Subscribing to 'mention' field...`)
        const response = await fetch(subscribeUrl, {
          method: 'POST',
        })

        if (response.ok) {
          const data = await response.json()
          console.log(`✅ Successfully subscribed to 'mention' field!`)
          console.log(`   Response:`, JSON.stringify(data, null, 2))
        } else {
          const errorData = await response.json().catch(() => ({}))
          console.error(`❌ Failed to subscribe:`, errorData)
          
          if (errorData.error) {
            console.error(`   Error Code: ${errorData.error.code}`)
            console.error(`   Error Message: ${errorData.error.message}`)
            console.error(`   Error Type: ${errorData.error.type}`)
            
            if (errorData.error.message?.includes('permission')) {
              console.log(`\n💡 The 'mention' field may require:`)
              console.log(`   • App Review from Facebook`)
              console.log(`   • Specific permissions (pages_read_engagement)`)
              console.log(`   • Or it may not be available for your app type`)
            }
          }
        }

        // Verify subscription with detailed response
        console.log(`\n🔍 Verifying subscription...`)
        const verifyUrl = `https://graph.facebook.com/v18.0/${integration.pageId}/subscribed_apps?access_token=${integration.accessToken}`
        const verifyResponse = await fetch(verifyUrl, { method: 'GET' })
        
        if (verifyResponse.ok) {
          const verifyData = await verifyResponse.json()
          console.log(`📋 Full verification response:`, JSON.stringify(verifyData, null, 2))
          
          const subscribedFields = verifyData.data?.map((item: any) => item.name) || []
          
          console.log(`\n📋 Currently subscribed fields:`)
          if (subscribedFields.length === 0) {
            console.log(`   ⚠️  No fields subscribed (only 'app' field shown)`)
          } else {
            subscribedFields.forEach((field: string) => {
              const isMention = field === 'mention'
              console.log(`   ${isMention ? '✅' : '  '} ${field}${isMention ? ' (MENTION)' : ''}`)
            })
          }
          
          if (!subscribedFields.includes('mention')) {
            console.log(`\n❌ 'mention' field is NOT subscribed`)
            console.log(`\n💡 Why this happens:`)
            console.log(`   • The 'mention' field requires App Review from Facebook`)
            console.log(`   • Your app needs to be in 'Live' mode (not Development mode)`)
            console.log(`   • Facebook may require specific use case justification`)
            console.log(`   • The field might not be available for all app types`)
            console.log(`\n🔧 Solutions:`)
            console.log(`   1. Submit your app for App Review`)
            console.log(`      → Go to: https://developers.facebook.com/apps/${process.env.FACEBOOK_APP_ID}/app-review/`)
            console.log(`      → Request 'pages_read_engagement' permission`)
            console.log(`      → Request 'mention' webhook field access`)
            console.log(`\n   2. Alternative: Monitor 'feed' field for mentions`)
            console.log(`      → Mentions might appear in 'feed' events`)
            console.log(`      → Check if post contains your page mention`)
            console.log(`      → This is already subscribed ✅`)
            console.log(`\n   3. Use Facebook Page Inbox API`)
            console.log(`      → Monitor page inbox for mentions`)
            console.log(`      → Requires different permissions`)
          } else {
            console.log(`\n✅ 'mention' field is subscribed!`)
            console.log(`   You will now receive notifications when your page is mentioned.`)
          }
        } else {
          const errorData = await verifyResponse.json().catch(() => ({}))
          console.error(`❌ Failed to verify subscription:`, errorData)
        }

      } catch (error: any) {
        console.error(`❌ Error subscribing page ${integration.pageId}:`, error.message)
      }
      
      console.log('\n' + '='.repeat(60) + '\n')
    }

    console.log('✅ Subscription process completed!')
    
  } catch (error: any) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
subscribeToMention()

