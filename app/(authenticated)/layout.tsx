import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { TopNav } from '@/components/layout/top-nav'
import { Sidebar } from '@/components/layout/sidebar'
import { SidebarProvider } from '@/components/layout/sidebar-context'
import { MainContent } from '@/components/layout/main-content'

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/auth/signin')
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen bg-gray-50">
        <TopNav />
        <Sidebar />
        <MainContent>
          {children}
        </MainContent>
      </div>
    </SidebarProvider>
  )
}

