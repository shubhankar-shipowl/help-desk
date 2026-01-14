import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AddCategoryDialog } from '@/components/admin/add-category-dialog'
import { CategoryActionsMenu } from '@/components/admin/category-actions-menu'
import { EmailTemplatesSection } from '@/components/admin/email-templates-section'
import { AutomationSection } from '@/components/admin/automation-section'
import { IntegrationsSection } from '@/components/admin/integrations-section'
import { EmailConfig } from '@/components/admin/email-config'
import { GeneralConfig } from '@/components/admin/general-config'
import { FacebookConfig } from '@/components/admin/facebook-config'
import { OrderTrackingUpload } from '@/components/admin/order-tracking-upload'
import { GeneralSettings } from '@/components/admin/general-settings'

export default async function AdminSettingsPage() {
  const session = await getServerSession(authOptions)

  if (!session || session.user.role !== 'ADMIN') {
    redirect('/auth/signin')
  }

  // Fetch categories from database
  const categories = await prisma.category.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      icon: true,
      color: true,
      description: true,
      subjects: true,
      _count: {
        select: { tickets: true },
      },
    },
  })

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-h1 mb-2">Settings</h1>
        <p className="text-gray-600">Manage your support portal configuration</p>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <div className="w-full overflow-x-auto">
          <TabsList className="inline-flex w-full h-auto flex-nowrap">
            <TabsTrigger value="general" className="whitespace-nowrap">General</TabsTrigger>
            <TabsTrigger value="categories" className="whitespace-nowrap">Categories</TabsTrigger>
            <TabsTrigger value="templates" className="whitespace-nowrap">Email Templates</TabsTrigger>
            <TabsTrigger value="automation" className="whitespace-nowrap">Automation</TabsTrigger>
            <TabsTrigger value="integrations" className="whitespace-nowrap">Integrations</TabsTrigger>
            <TabsTrigger value="order-tracking" className="whitespace-nowrap">Order Tracking</TabsTrigger>
          </TabsList>
        </div>

        {/* General Settings */}
        <TabsContent value="general" className="space-y-6">
          <GeneralSettings />
        </TabsContent>

        {/* Categories */}
        <TabsContent value="categories" className="space-y-6">
          <Card className="border border-gray-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-h3">Categories</CardTitle>
                <CardDescription>Organize tickets by category</CardDescription>
              </div>
              <AddCategoryDialog />
            </CardHeader>
            <CardContent>
              {categories.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <p>No categories found. Create your first category!</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {categories.map((category) => (
                    <div
                      key={category.id}
                      className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <span className="text-gray-400 cursor-move">⋮⋮</span>
                      <span className="flex-1 font-medium">{category.name}</span>
                      <span className="text-sm text-gray-500">
                        {category._count.tickets} ticket{category._count.tickets !== 1 ? 's' : ''}
                      </span>
                      <CategoryActionsMenu category={category} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Email Templates */}
        <TabsContent value="templates" className="space-y-6">
          <EmailTemplatesSection />
        </TabsContent>

        {/* Automation Rules */}
        <TabsContent value="automation" className="space-y-6">
          <AutomationSection />
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations" className="space-y-6">
          <GeneralConfig />
          <FacebookConfig />
          <IntegrationsSection />
          <EmailConfig />
        </TabsContent>

        {/* Order Tracking */}
        <TabsContent value="order-tracking" className="space-y-6">
          <OrderTrackingUpload />
        </TabsContent>
      </Tabs>
    </div>
  )
}

