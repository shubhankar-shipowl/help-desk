'use client'

import { useState, useEffect } from 'react'

interface Store {
  id: string
  name: string
}

interface StoreSelectProps {
  value: string | null
  onChange: (storeId: string | null) => void
  label?: string
  required?: boolean
  includeAll?: boolean
  className?: string
}

export default function StoreSelect({
  value,
  onChange,
  label = 'Store',
  required = false,
  includeAll = false,
  className = '',
}: StoreSelectProps) {
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStores()
  }, [])

  const fetchStores = async () => {
    try {
      const response = await fetch('/api/stores?activeOnly=true')
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

  return (
    <div className={className}>
      <label className="block text-sm font-medium mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        required={required}
        disabled={loading}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {includeAll && <option value="">All Stores</option>}
        {!includeAll && !required && <option value="">No Store</option>}
        {loading ? (
          <option disabled>Loading stores...</option>
        ) : (
          stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))
        )}
      </select>
    </div>
  )
}
