/** @type {import('next').NextConfig} */
const EMAIL_SERVICE_URL = process.env.EMAIL_SERVICE_URL || 'http://localhost:4003';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4004';
const CALLING_SERVICE_URL = process.env.CALLING_SERVICE_URL || 'http://localhost:4005';
const FACEBOOK_SERVICE_URL = process.env.FACEBOOK_SERVICE_URL || 'http://localhost:4006';
const ORDER_TRACKING_SERVICE_URL = process.env.ORDER_TRACKING_SERVICE_URL || 'http://localhost:4007';

const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  images: {
    domains: ['graph.facebook.com', 'scontent.xx.fbcdn.net'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    serverComponentsExternalPackages: ['megajs', '@prisma/client', 'bcryptjs', 'nodemailer'],
  },
  async rewrites() {
    return [
      // Email service rewrites
      { source: '/api/emails/:id/reply', destination: `${EMAIL_SERVICE_URL}/emails/:id/reply` },
      { source: '/api/emails/:id/create-ticket', destination: `${EMAIL_SERVICE_URL}/emails/:id/create-ticket` },
      { source: '/api/emails/:id/process-images', destination: `${EMAIL_SERVICE_URL}/emails/:id/process-images` },
      { source: '/api/emails/:id/repair-images', destination: `${EMAIL_SERVICE_URL}/emails/:id/repair-images` },
      { source: '/api/emails/:id', destination: `${EMAIL_SERVICE_URL}/emails/:id` },
      { source: '/api/emails/fetch', destination: `${EMAIL_SERVICE_URL}/emails/fetch` },
      { source: '/api/emails/sync', destination: `${EMAIL_SERVICE_URL}/emails/sync` },
      { source: '/api/emails/test-imap', destination: `${EMAIL_SERVICE_URL}/emails/test-imap` },
      { source: '/api/emails/delete', destination: `${EMAIL_SERVICE_URL}/emails/delete` },
      { source: '/api/emails', destination: `${EMAIL_SERVICE_URL}/emails` },
      // Notification service rewrites (specific routes first)
      { source: '/api/notifications/mark-all-read', destination: `${NOTIFICATION_SERVICE_URL}/notifications/mark-all-read` },
      { source: '/api/notifications/unread-count', destination: `${NOTIFICATION_SERVICE_URL}/notifications/unread-count` },
      { source: '/api/notifications/preferences', destination: `${NOTIFICATION_SERVICE_URL}/notifications/preferences` },
      { source: '/api/notifications/push/subscribe', destination: `${NOTIFICATION_SERVICE_URL}/notifications/push/subscribe` },
      { source: '/api/notifications/:id', destination: `${NOTIFICATION_SERVICE_URL}/notifications/:id` },
      { source: '/api/notifications', destination: `${NOTIFICATION_SERVICE_URL}/notifications` },
      // Calling service rewrites
      { source: '/api/call-logs/refresh', destination: `${CALLING_SERVICE_URL}/call-logs/refresh` },
      { source: '/api/call-logs', destination: `${CALLING_SERVICE_URL}/call-logs` },
      { source: '/api/tickets/:id/call', destination: `${CALLING_SERVICE_URL}/calls/initiate/:id` },
      { source: '/api/exotel/webhook', destination: `${CALLING_SERVICE_URL}/exotel/webhook` },
      { source: '/api/exotel/status-callback', destination: `${CALLING_SERVICE_URL}/exotel/status-callback` },
      // Facebook service rewrites
      { source: '/api/facebook/connect', destination: `${FACEBOOK_SERVICE_URL}/facebook/connect` },
      { source: '/api/facebook/callback', destination: `${FACEBOOK_SERVICE_URL}/facebook/callback` },
      { source: '/api/facebook/disconnect', destination: `${FACEBOOK_SERVICE_URL}/facebook/disconnect` },
      { source: '/api/facebook/integration/settings', destination: `${FACEBOOK_SERVICE_URL}/facebook/integration/settings` },
      { source: '/api/facebook/integration/disconnect', destination: `${FACEBOOK_SERVICE_URL}/facebook/integration/disconnect` },
      { source: '/api/facebook/integration', destination: `${FACEBOOK_SERVICE_URL}/facebook/integration` },
      { source: '/api/tickets/convert-facebook', destination: `${FACEBOOK_SERVICE_URL}/facebook/convert-ticket` },
      { source: '/api/integrations/facebook/config', destination: `${FACEBOOK_SERVICE_URL}/facebook/config` },
      { source: '/webhooks/facebook', destination: `${FACEBOOK_SERVICE_URL}/webhooks/facebook` },
      // Order tracking service rewrites
      { source: '/api/order-tracking/upload', destination: `${ORDER_TRACKING_SERVICE_URL}/order-tracking/upload` },
      { source: '/api/order-tracking/lookup', destination: `${ORDER_TRACKING_SERVICE_URL}/order-tracking/lookup` },
      { source: '/api/order-tracking/vendors', destination: `${ORDER_TRACKING_SERVICE_URL}/order-tracking/vendors` },
      { source: '/api/order-tracking/delete', destination: `${ORDER_TRACKING_SERVICE_URL}/order-tracking/delete` },
    ]
  },
  // Optimize build memory usage
  typescript: {
    // Type checking is done separately, reduce memory during build
    ignoreBuildErrors: false,
  },
  eslint: {
    // ESLint is done separately, reduce memory during build
    ignoreDuringBuilds: false,
  },
  webpack: (config, { dev, isServer }) => {
    // Exclude server-only modules from client bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      }
    }
    
    // Mark megajs as external for client bundle (server-only module)
    if (!isServer) {
      config.externals = config.externals || []
      config.externals.push('megajs')
    }
    
    // Fix for webpack hot-update 404 errors
    if (dev && !isServer) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      }
    }
    return config
  },
  // Suppress webpack warnings about missing modules during HMR
  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
  },
}

module.exports = nextConfig
