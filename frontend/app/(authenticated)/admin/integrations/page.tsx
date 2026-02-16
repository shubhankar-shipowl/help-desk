import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { FacebookIntegration } from '@prisma/client'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plug, Facebook, CheckCircle, XCircle, Settings, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { ConnectFacebookButton } from '@/components/admin/connect-facebook-button'
import { DisconnectFacebookButton } from '@/components/admin/disconnect-facebook-button'

export default async function AdminIntegrationsPage() {
  const session = await getServerSession(authOptions)

  if (!session || session.user.role !== 'ADMIN') {
    redirect('/auth/signin')
  }

  // Fetch Facebook integrations
  const facebookIntegrations = await prisma.facebookIntegration.findMany({
    orderBy: { createdAt: 'desc' },
  })

  // Get recent Facebook notifications
  const recentNotifications = await prisma.facebookNotification.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: {
      Notification: {
        include: {
          User_Notification_userIdToUser: {
            select: { name: true, email: true },
          },
        },
      },
    },
  })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-h1 mb-2">Integrations</h1>
        <p className="text-gray-600">Manage third-party integrations and connections</p>
      </div>

      {/* Facebook Integration */}
      <Card className="border border-gray-200 mb-6">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <Facebook className="h-6 w-6 text-blue-600" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-h3">Facebook Integration</CardTitle>
              <CardDescription>
                Connect your Facebook page to create tickets from messages, posts, and comments
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {facebookIntegrations.length === 0 ? (
              <div className="text-center py-8 border border-gray-200 rounded-lg">
                <Facebook className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="font-semibold text-gray-900 mb-2">No Facebook Pages Connected</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Connect your Facebook page to start receiving notifications and creating tickets from Facebook interactions.
                </p>
                <ConnectFacebookButton />
              </div>
          ) : (
            <div className="space-y-4">
              {facebookIntegrations.map((integration: FacebookIntegration) => (
                <div
                  key={integration.id}
                  className="p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4 flex-1">
                      <div className="w-16 h-16 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Facebook className="h-8 w-8 text-blue-600" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="font-semibold text-gray-900">{integration.pageName}</h4>
                          <Badge
                            variant={integration.isActive ? 'default' : 'secondary'}
                            className={
                              integration.isActive
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-700'
                            }
                          >
                            {integration.isActive ? (
                              <>
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Active
                              </>
                            ) : (
                              <>
                                <XCircle className="h-3 w-3 mr-1" />
                                Inactive
                              </>
                            )}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">
                          Page ID: <span className="font-mono text-xs">{integration.pageId}</span>
                        </p>
                        <p className="text-xs text-gray-500">
                          Connected: {new Date(integration.createdAt).toLocaleDateString()}
                        </p>
                        {integration.updatedAt && (
                          <p className="text-xs text-gray-500">
                            Last updated: {new Date(integration.updatedAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm">
                        <Settings className="h-4 w-4 mr-2" />
                        Configure
                      </Button>
                      <DisconnectFacebookButton 
                        pageId={integration.pageId}
                        pageName={integration.pageName}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Integration Features */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h4 className="font-semibold text-gray-900 mb-4">Features</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Page Posts</p>
                  <p className="text-xs text-gray-600">
                    Get notified when someone posts on your Facebook page
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Comments</p>
                  <p className="text-xs text-gray-600">
                    Monitor and respond to comments on your posts
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Direct Messages</p>
                  <p className="text-xs text-gray-600">
                    Receive and manage Facebook messages as tickets
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Auto Ticket Creation</p>
                  <p className="text-xs text-gray-600">
                    Automatically create tickets from Facebook interactions
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent Facebook Notifications */}
      {recentNotifications.length > 0 && (
        <Card className="border border-gray-200">
          <CardHeader>
            <CardTitle>Recent Facebook Activity</CardTitle>
            <CardDescription>
              Latest notifications from your connected Facebook pages
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentNotifications.map((fbNotification) => (
                <div
                  key={fbNotification.id}
                  className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <Facebook className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm text-gray-900">
                        {fbNotification.author}
                      </p>
                      <Badge variant="outline" className="text-xs">
                        {fbNotification.type}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600 line-clamp-2 mb-2">
                      {fbNotification.content}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{new Date(fbNotification.createdAt).toLocaleString()}</span>
                      {fbNotification.postUrl && (
                        <>
                          <span>•</span>
                          <a
                            href={fbNotification.postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-blue-600 hover:text-blue-700"
                          >
                            View on Facebook
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </>
                      )}
                      {fbNotification.converted && (
                        <>
                          <span>•</span>
                          <Badge variant="outline" className="text-xs bg-green-50 text-green-700">
                            Converted to Ticket
                          </Badge>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Other Integrations Placeholder */}
      <Card className="border border-gray-200 mt-6">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Plug className="h-6 w-6 text-gray-400" />
            <CardTitle className="text-h3">More Integrations</CardTitle>
          </div>
          <CardDescription>
            Additional integrations coming soon
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            <p className="text-sm">More integration options will be available in future updates.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

