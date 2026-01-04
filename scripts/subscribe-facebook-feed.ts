#!/usr/bin/env tsx
/**
 * Subscribe Facebook page to feed field
 * Run: npx tsx scripts/subscribe-facebook-feed.ts
 */

import { prisma } from '../lib/prisma'
import axios from 'axios'

async function subscribeFacebookFeed() {
  console.log('🔧 Subscribing Facebook Page to Feed Field...\n')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  try {
    // Get active integrations
    const integrations = await prisma.facebookIntegration.findMany({
      where: { isActive: true },
    })

    if (integrations.length === 0) {
      console.log('❌ No active Facebook integrations found!')
      return
    }

    for (const integration of integrations) {
      console.log(`📄 Page: ${integration.pageName}`)
      console.log(`   Page ID: ${integration.pageId}`)
      console.log(`   Access Token: ${integration.accessToken.substring(0, 20)}...`)
      console.log('')

      try {
        // Subscribe to feed and messages fields
        console.log('📤 Subscribing to feed and messages fields...')
        console.log('   Using page access token...')
        
        const response = await axios.post(
          `https://graph.facebook.com/v18.0/${integration.pageId}/subscribed_apps`,
          null,
          {
            params: {
              subscribed_fields: 'feed,messages',
              access_token: integration.accessToken,
            },
          }
        )

        if (response.data.success) {
          console.log('   ✅ API call successful!')
          console.log('   Attempted to subscribe: feed, messages')
          console.log('')
          
          // CRITICAL: Verify what was actually subscribed
          console.log('🔍 Verifying actual subscription status...')
          const verifyResponse = await axios.get(
            `https://graph.facebook.com/v18.0/${integration.pageId}/subscribed_apps`,
            {
              params: {
                access_token: integration.accessToken,
              },
            }
          )

          if (verifyResponse.data.data && verifyResponse.data.data.length > 0) {
            const subscribedFields = verifyResponse.data.data.map((sub: any) => 
              sub.name || sub.category || 'Unknown'
            )
            
            console.log('   Actual subscribed fields:')
            subscribedFields.forEach((field: string) => {
              console.log(`      • ${field}`)
            })
            console.log('')
            
            // Check if feed is actually subscribed
            const hasFeed = subscribedFields.some((field: string) => 
              field.toLowerCase() === 'feed' || 
              field.toLowerCase() === 'page_feed' ||
              field.toLowerCase().includes('feed')
            )
            
            if (!hasFeed) {
              console.log('   ⚠️  WARNING: "feed" field is NOT actually subscribed!')
              console.log('   Facebook API returned success but ignored the feed field.')
              console.log('   This usually means missing permissions.')
              console.log('')
              console.log('   🔧 SOLUTION: Subscribe via Facebook Developer Console UI')
              console.log('   1. Go to: https://developers.facebook.com/')
              console.log('   2. Select your App')
              console.log('   3. Products → Webhooks → Page')
              console.log('   4. Find your page and click "Edit Subscription"')
              console.log('   5. Check the "feed" field checkbox')
              console.log('   6. Click "Save"')
              console.log('')
            } else {
              console.log('   ✅ "feed" field is actually subscribed!')
              console.log('   Webhook should now receive post events.')
              console.log('')
            }
          } else {
            console.log('   ⚠️  Could not verify subscription status')
            console.log('')
          }
        } else {
          console.log('   ⚠️  Subscription API returned error:', response.data)
          console.log('')
        }
        console.log('')

      } catch (apiError: any) {
        console.log('   ❌ Error subscribing:')
        const errorMsg = apiError.response?.data?.error || apiError.message
        console.log(`   ${JSON.stringify(errorMsg, null, 2)}`)
        console.log('')
        
        if (apiError.response?.data?.error?.code === 190) {
          console.log('   💡 Access token is expired or invalid.')
          console.log('   Fix: Reconnect the Facebook page via /admin/integrations')
          console.log('')
        } else if (apiError.response?.data?.error?.code === 200 || 
                   apiError.response?.data?.error?.code === 100) {
          console.log('   💡 Missing permissions or App Review required.')
          console.log('   The "feed" field requires "pages_read_engagement" permission')
          console.log('   which needs App Review or must be done via Facebook UI.')
          console.log('')
          console.log('   🔧 SOLUTION: Subscribe via Facebook Developer Console UI')
          console.log('   1. Go to: https://developers.facebook.com/')
          console.log('   2. Select your App')
          console.log('   3. Products → Webhooks → Page')
          console.log('   4. Find your page and click "Edit Subscription"')
          console.log('   5. Check the "feed" field checkbox')
          console.log('   6. Click "Save"')
          console.log('')
        }
      }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📋 Important Notes:\n')
    console.log('⚠️  If "feed" field is NOT subscribed:')
    console.log('   The API subscription method may not work due to missing permissions.')
    console.log('   You MUST subscribe via Facebook Developer Console UI:\n')
    console.log('   1. Go to: https://developers.facebook.com/')
    console.log('   2. Select your App')
    console.log('   3. Products → Webhooks → Page')
    console.log('   4. Find your page: Shoperskart')
    console.log('   5. Click "Edit Subscription" or "Manage Subscription"')
    console.log('   6. Check the "feed" checkbox')
    console.log('   7. Click "Save" or "Update Subscription"\n')
    console.log('📋 After subscribing via UI:\n')
    console.log('1. Verify subscription:')
    console.log('   npx tsx scripts/check-facebook-subscription.ts')
    console.log('   • Should now show "feed" in subscribed fields\n')
    console.log('2. Test webhook:')
    console.log('   • Post on your Facebook page')
    console.log('   • Check ngrok dashboard for POST requests')
    console.log('   • Check server logs for webhook events\n')

  } catch (error: any) {
    console.error('❌ Error:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

subscribeFacebookFeed()

