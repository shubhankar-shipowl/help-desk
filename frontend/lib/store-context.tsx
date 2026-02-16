'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'

interface StoreContextType {
  selectedStoreId: string | null
  setSelectedStoreId: (storeId: string | null) => void
  stores: Array<{ id: string; name: string }>
  loading: boolean
  refreshStores: () => Promise<void>
}

const StoreContext = createContext<StoreContextType | undefined>(undefined)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null)
  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)

  // Load selected store from localStorage on mount
  useEffect(() => {
    const savedStoreId = localStorage.getItem('selectedStoreId')
    if (savedStoreId) {
      setSelectedStoreId(savedStoreId)
    }
  }, [])

  // Fetch stores when user is admin
  useEffect(() => {
    if (session?.user?.role === 'ADMIN') {
      fetchStores()
    } else {
      setLoading(false)
    }
  }, [session])

  const fetchStores = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/stores?activeOnly=true')
      if (response.ok) {
        const data = await response.json()
        setStores(data.stores)
        
        // Auto-select first store if no store is selected and stores are available
        const savedStoreId = localStorage.getItem('selectedStoreId')
        if (!savedStoreId && data.stores && data.stores.length > 0) {
          const firstStoreId = data.stores[0].id
          setSelectedStoreId(firstStoreId)
          localStorage.setItem('selectedStoreId', firstStoreId)
        }
      }
    } catch (error) {
      console.error('Error fetching stores:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSetSelectedStoreId = (storeId: string | null) => {
    setSelectedStoreId(storeId)
    if (storeId) {
      localStorage.setItem('selectedStoreId', storeId)
    } else {
      localStorage.removeItem('selectedStoreId')
    }
  }

  return (
    <StoreContext.Provider
      value={{
        selectedStoreId,
        setSelectedStoreId: handleSetSelectedStoreId,
        stores,
        loading,
        refreshStores: fetchStores,
      }}
    >
      {children}
    </StoreContext.Provider>
  )
}

export function useStore() {
  const context = useContext(StoreContext)
  if (context === undefined) {
    throw new Error('useStore must be used within a StoreProvider')
  }
  return context
}
