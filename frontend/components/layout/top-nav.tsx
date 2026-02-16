'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSession, signOut } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NotificationDropdown } from '@/components/notifications/NotificationDropdown'
import { Search, Plus, User, Settings, LogOut, Menu, Store, Link as LinkIcon, Copy } from 'lucide-react'
import { useStore } from '@/lib/store-context'
import { useToast } from '@/components/ui/use-toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function TopNav() {
  const { data: session } = useSession()
  const { toast } = useToast()
  const [searchQuery, setSearchQuery] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { selectedStoreId, setSelectedStoreId, stores, loading } = useStore()

  const copyPublicUrl = async (storeId: string | null) => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
    const publicUrl = storeId 
      ? `${baseUrl}/tickets/new?storeId=${storeId}`
      : `${baseUrl}/tickets/new`
    
    try {
      await navigator.clipboard.writeText(publicUrl)
      toast({
        title: 'Copied!',
        description: 'Public ticket URL copied to clipboard',
      })
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = publicUrl
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      toast({
        title: 'Copied!',
        description: 'Public ticket URL copied to clipboard',
      })
    }
  }

  return (
    <header className="fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-200 z-50">
      <div className="flex items-center h-full px-4 gap-4">
        {/* Mobile Menu Button */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden mr-2"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Left Section - Logo */}
        <Link href="/" className="flex items-center gap-2 w-60 px-4 flex-shrink-0">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">S</span>
          </div>
          <span className="font-bold text-lg text-gray-900">Shipowl Support</span>
        </Link>

        {/* Center Section - Search */}
        <div className="flex-1 max-w-2xl mx-4 md:mx-8">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 z-10" />
            <Input
              type="text"
              placeholder="Search tickets, customers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-8 h-10 bg-white border border-gray-300 focus:bg-white focus:ring-2 focus:ring-primary focus:border-primary rounded-lg text-sm shadow-sm"
            />
            <kbd className="absolute right-3 top-1/2 transform -translate-y-1/2 hidden md:inline-flex h-5 select-none items-center gap-1 rounded border border-gray-200 bg-white px-1.5 font-mono text-[10px] font-medium text-gray-500 shadow-sm">
              ⌘K
            </kbd>
          </div>
        </div>

        {/* Right Section - Actions */}
        <div className="flex items-center gap-2 ml-auto">
          {/* Quick Create */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                className="h-10 w-10 rounded-full bg-primary hover:bg-primary-dark"
              >
                <Plus className="h-5 w-5 text-white" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {session?.user?.role === 'AGENT' || session?.user?.role === 'ADMIN' ? (
                <>
                  <DropdownMenuItem asChild>
                    <Link href="/agent/tickets/new">New Ticket (Agent)</Link>
                  </DropdownMenuItem>
                  {session?.user?.role === 'ADMIN' && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={() => copyPublicUrl(selectedStoreId)}
                        className="flex items-center gap-2"
                      >
                        <Copy className="h-4 w-4" />
                        Copy Public URL {selectedStoreId ? `(${stores.find(s => s.id === selectedStoreId)?.name || 'Store'})` : ''}
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link 
                          href={selectedStoreId ? `/tickets/new?storeId=${selectedStoreId}` : '/tickets/new'}
                          className="flex items-center gap-2"
                        >
                          <LinkIcon className="h-4 w-4" />
                          Open Public Form {selectedStoreId ? `(${stores.find(s => s.id === selectedStoreId)?.name || 'Store'})` : ''}
                        </Link>
                      </DropdownMenuItem>
                    </>
                  )}
                </>
              ) : (
                <>
                  <DropdownMenuItem asChild>
                    <Link href="/tickets/new">New Ticket (Public)</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/customer/tickets/new">New Ticket (Logged In)</Link>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Notifications */}
          <NotificationDropdown />

          {/* Store Selector (Admin Only) */}
          {session?.user?.role === 'ADMIN' && (
            <Select
              value={selectedStoreId || ''}
              onValueChange={(value) => setSelectedStoreId(value || null)}
              disabled={loading}
            >
              <SelectTrigger className="w-[180px] h-10">
                <div className="flex items-center gap-2">
                  <Store className="h-4 w-4" />
                  <SelectValue placeholder="Select Store" />
                </div>
              </SelectTrigger>
              <SelectContent>
                {stores.map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-10 px-2 gap-2">
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                  {session?.user?.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={session.user.avatar}
                      alt={session.user.name || ''}
                      className="h-full w-full rounded-full"
                    />
                  ) : (
                    <span className="text-primary font-medium text-sm">
                      {session?.user?.name?.charAt(0) || session?.user?.email?.charAt(0) || 'U'}
                    </span>
                  )}
                </div>
                <span className="hidden md:inline text-sm font-medium">
                  {session?.user?.name || session?.user?.email}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="font-medium">{session?.user?.name || 'User'}</span>
                  <span className="text-xs text-muted-foreground">{session?.user?.email}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings/profile" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={session?.user?.role === 'ADMIN' ? '/admin/settings' : '/settings'} className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={async () => {
                await signOut({ redirect: false });
                window.location.href = '/auth/signin';
              }} className="text-destructive">
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

