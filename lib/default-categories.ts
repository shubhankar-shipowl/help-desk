/**
 * Default categories and subjects that are automatically created for new stores
 */
export const DEFAULT_CATEGORIES = [
  { 
    name: '📦 Order & Product Issues', 
    icon: '📦', 
    color: '#EF4444', 
    description: 'Issues related to orders and products',
    subjects: [
      'Wrong Product Delivered',
      'Missing Item in Order',
      'Damaged Product Received',
      'Defective Product',
      'Product Not as Described'
    ]
  },
  { 
    name: '🔄 Return / Refund / Replacement', 
    icon: '🔄', 
    color: '#F59E0B', 
    description: 'Return, refund, and replacement requests',
    subjects: [
      'Return Request',
      'Refund Request',
      'Replacement Request',
      'Refund Not Received',
      'Return Pickup Issue'
    ]
  },
  { 
    name: '🚚 Delivery Issues', 
    icon: '🚚', 
    color: '#3B82F6', 
    description: 'Issues related to order delivery',
    subjects: [
      'Order Not Delivered',
      'Delayed Delivery',
      'Tracking Issue',
      'Delivery Address Change Request'
    ]
  },
  { 
    name: '💳 Payment Issues', 
    icon: '💳', 
    color: '#8B5CF6', 
    description: 'Issues related to payments and billing',
    subjects: [
      'Payment Failed',
      'Amount Debited but Order Not Placed',
      'Invoice / Billing Issue'
    ]
  },
]

/**
 * Creates default categories for a store
 * @param tenantId - The tenant ID
 * @param storeId - The store ID (null for tenant-level categories)
 * @param prisma - Prisma client instance
 */
export async function createDefaultCategoriesForStore(
  tenantId: string,
  storeId: string | null,
  prisma: any
) {
  const categories = []
  
  for (const category of DEFAULT_CATEGORIES) {
    // Check if category already exists
    const existing = await prisma.category.findFirst({
      where: {
        tenantId,
        storeId,
        name: category.name,
      },
    })
    
    if (!existing) {
      const created = await prisma.category.create({
        data: {
          tenantId,
          storeId,
          name: category.name,
          icon: category.icon,
          color: category.color,
          description: category.description,
          subjects: category.subjects || null,
        },
      })
      categories.push(created)
    } else {
      // Update existing category with subjects if they don't have any
      if (!existing.subjects && category.subjects) {
        await prisma.category.update({
          where: { id: existing.id },
          data: { subjects: category.subjects },
        })
      }
      categories.push(existing)
    }
  }
  
  return categories
}
