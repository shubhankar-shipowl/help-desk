'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store-context'
import { 
  Plus, 
  Store, 
  Edit, 
  Trash2,
  CheckCircle,
  XCircle
} from 'lucide-react'

interface Store {
  id: string
  name: string
  description?: string
  address?: string
  phone?: string
  email?: string
  isActive: boolean
  createdAt: string
  _count?: {
    User: number
    Ticket: number
  }
}

export default function StoresPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { refreshStores } = useStore() // Get refresh function from context
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingStore, setEditingStore] = useState<Store | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    address: '',
    phone: '',
    email: '',
  })

  // Redirect if not admin
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
    } else if (status === 'authenticated' && session?.user?.role !== 'ADMIN') {
      router.push('/')
    }
  }, [status, session, router])

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role === 'ADMIN') {
      fetchStores()
    }
  }, [status, session])

  const fetchStores = async () => {
    try {
      const response = await fetch('/api/stores')
      if (response.ok) {
        const data = await response.json()
        setStores(data.stores)
      }
    } catch (error) {
      console.error('Error fetching stores:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      const url = editingStore ? `/api/stores/${editingStore.id}` : '/api/stores'
      const method = editingStore ? 'PUT' : 'POST'
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        await fetchStores() // Refresh local stores list
        await refreshStores() // Refresh store context (updates dropdown)
        setShowModal(false)
        resetForm()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to save store')
      }
    } catch (error) {
      console.error('Error saving store:', error)
      alert('Failed to save store')
    }
  }

  const handleEdit = (store: Store) => {
    setEditingStore(store)
    setFormData({
      name: store.name,
      description: store.description || '',
      address: store.address || '',
      phone: store.phone || '',
      email: store.email || '',
    })
    setShowModal(true)
  }

  const handleDelete = async (storeId: string, storeName: string) => {
    const confirmMessage = `Are you sure you want to permanently delete "${storeName}"?\n\nThis will:\n- Remove the store permanently\n- Unassign all users, tickets, and other data from this store\n\nThis action cannot be undone!`
    
    if (!confirm(confirmMessage)) return

    try {
      // Use hard delete to permanently remove the store
      const response = await fetch(`/api/stores/${storeId}?hard=true`, {
        method: 'DELETE',
      })

      if (response.ok) {
        await fetchStores() // Refresh local stores list
        await refreshStores() // Refresh store context (updates dropdown)
        alert('Store deleted successfully')
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to delete store')
      }
    } catch (error) {
      console.error('Error deleting store:', error)
      alert('Failed to delete store')
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      address: '',
      phone: '',
      email: '',
    })
    setEditingStore(null)
  }

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    )
  }

  if (session?.user?.role !== 'ADMIN') {
    return null
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Store Management</h1>
        <button
          onClick={() => {
            resetForm()
            setShowModal(true)
          }}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-5 h-5" />
          Add Store
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {stores.map((store) => (
          <div
            key={store.id}
            className="bg-white rounded-lg shadow-md p-6 border border-gray-200"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <Store className="w-8 h-8 text-blue-600" />
                <div>
                  <h3 className="text-lg font-semibold">{store.name}</h3>
                  {store.isActive ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600">
                      <CheckCircle className="w-4 h-4" />
                      Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-red-600">
                      <XCircle className="w-4 h-4" />
                      Inactive
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleEdit(store)}
                  className="text-blue-600 hover:text-blue-800"
                >
                  <Edit className="w-5 h-5" />
                </button>
                <button
                  onClick={() => handleDelete(store.id, store.name)}
                  className="text-red-600 hover:text-red-800"
                  title="Delete store permanently"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>

            {store.description && (
              <p className="text-sm text-gray-600 mb-3">{store.description}</p>
            )}

            <div className="space-y-2 text-sm">
              {store.address && (
                <p className="text-gray-700">
                  <span className="font-medium">Address:</span> {store.address}
                </p>
              )}
              {store.phone && (
                <p className="text-gray-700">
                  <span className="font-medium">Phone:</span> {store.phone}
                </p>
              )}
              {store.email && (
                <p className="text-gray-700">
                  <span className="font-medium">Email:</span> {store.email}
                </p>
              )}
            </div>

            {store._count && (
              <div className="mt-4 pt-4 border-t border-gray-200 flex justify-between text-sm">
                <span className="text-gray-600">
                  {store._count.User} Agent{store._count.User !== 1 ? 's' : ''}
                </span>
                <span className="text-gray-600">
                  {store._count.Ticket} Ticket{store._count.Ticket !== 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {stores.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No stores found. Create your first store to get started.
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-2xl font-bold mb-4">
              {editingStore ? 'Edit Store' : 'Add New Store'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Store Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Address
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                  {editingStore ? 'Update' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    resetForm()
                  }}
                  className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
