import { Storage } from 'megajs'
import { Readable } from 'stream'

/**
 * MEGA Storage Service
 * Handles file uploads to MEGA cloud storage
 * 
 * IMPORTANT:
 * - All uploads go through backend (never expose credentials to frontend)
 * - MEGA is used as private storage, NOT as CDN
 * - Database stores only metadata (file handle), not file binaries
 */

interface MegaConfig {
  email: string
  password: string
}

interface UploadResult {
  fileHandle: string // MEGA file handle (node handle)
  fileUrl: string // Internal URL for serving files (not public MEGA link)
  fileName: string
  fileSize: number
  mimeType: string
}

let megaStorage: any = null
let isInitialized = false

/**
 * Initialize MEGA storage connection
 */
async function initializeMega(): Promise<any> {
  if (isInitialized && megaStorage) {
    return megaStorage
  }

  const email = process.env.MEGA_EMAIL
  const password = process.env.MEGA_PASSWORD

  if (!email || !password) {
    throw new Error('MEGA credentials not configured. Please set MEGA_EMAIL and MEGA_PASSWORD environment variables.')
  }

  try {
    // Create MEGA Storage instance
    megaStorage = new Storage({ email, password })
    
    // Wait for login
    await new Promise<void>((resolve, reject) => {
      megaStorage.once('ready', () => {
        console.log('[MEGA] ✅ Connected to MEGA storage')
        isInitialized = true
        resolve()
      })
      
      megaStorage.once('error', (error: Error) => {
        console.error('[MEGA] ❌ Connection error:', error)
        reject(error)
      })
    })

    return megaStorage
  } catch (error: any) {
    console.error('[MEGA] Failed to initialize:', error)
    throw new Error(`Failed to initialize MEGA storage: ${error.message}`)
  }
}

/**
 * Get or create folder in MEGA
 * @param folderPath - Path like "help-desk/images" or "help-desk/videos"
 * @returns Folder node
 */
async function getOrCreateFolder(folderPath: string): Promise<any> {
  const storage = await initializeMega()
  const pathParts = folderPath.split('/').filter(Boolean)
  
  let currentFolder = storage.root
  
  for (const folderName of pathParts) {
    // Check if folder exists
    const existingFolder = currentFolder.children.find(
      (child: any) => child.name === folderName && child.directory
    )
    
    if (existingFolder) {
      currentFolder = existingFolder
    } else {
      // Create new folder
      const newFolder = await storage.mkdir(folderName, currentFolder)
      console.log(`[MEGA] 📁 Created folder: ${folderPath}`)
      currentFolder = newFolder
    }
  }
  
  return currentFolder
}

/**
 * Determine folder based on file type
 * @param mimeType - MIME type of the file
 * @returns Folder path
 */
function getFolderForFileType(mimeType: string): string {
  if (mimeType.startsWith('image/')) {
    return 'help-desk/images'
  } else if (mimeType.startsWith('video/')) {
    return 'help-desk/videos'
  } else {
    // Default to images folder for other file types
    return 'help-desk/images'
  }
}

/**
 * Upload file to MEGA storage
 * @param fileBuffer - File buffer to upload
 * @param fileName - Original file name
 * @param mimeType - MIME type of the file
 * @param ticketId - Optional ticket ID for organization
 * @returns Upload result with file handle and internal URL
 */
export async function uploadFileToMega(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  ticketId?: string
): Promise<UploadResult> {
  try {
    const storage = await initializeMega()
    
    // Determine folder based on file type
    const folderPath = getFolderForFileType(mimeType)
    const targetFolder = await getOrCreateFolder(folderPath)
    
    // Generate unique filename to avoid conflicts
    const timestamp = Date.now()
    const randomId = Math.random().toString(36).substring(7)
    const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
    const uniqueFileName = ticketId 
      ? `${ticketId}_${timestamp}_${randomId}_${sanitizedName}`
      : `${timestamp}_${randomId}_${sanitizedName}`
    
    // Upload file to MEGA using megajs API
    const fileNode = await new Promise<any>((resolve, reject) => {
      const uploadStream = storage.upload({
        name: uniqueFileName,
        size: fileBuffer.length,
        target: targetFolder,
      }, fileBuffer)
      
      uploadStream.on('complete', (file: any) => {
        resolve(file)
      })
      
      uploadStream.on('error', (error: Error) => {
        reject(error)
      })
    })
    
    // Get file handle (node handle)
    // MEGA files use nodeId as the handle/identifier
    const fileHandle = fileNode.nodeId || fileNode.h || fileNode.handle
    if (!fileHandle) {
      throw new Error('Failed to get file handle from MEGA')
    }
    
    // Create internal URL for serving files (not public MEGA link)
    // Format: /api/storage/mega/{fileHandle}
    const fileUrl = `/api/storage/mega/${fileHandle}`
    
    console.log(`[MEGA] ✅ File uploaded successfully:`)
    console.log(`   - File Name: ${fileName}`)
    console.log(`   - Unique Name: ${uniqueFileName}`)
    console.log(`   - File Handle: ${fileHandle}`)
    console.log(`   - Folder: ${folderPath}`)
    console.log(`   - MIME Type: ${mimeType}`)
    console.log(`   - Size: ${(fileBuffer.length / 1024).toFixed(2)} KB`)
    
    return {
      fileHandle,
      fileUrl,
      fileName: uniqueFileName,
      fileSize: fileBuffer.length,
      mimeType,
    }
  } catch (error: any) {
    console.error('[MEGA] Error uploading file:', error)
    throw new Error(`Failed to upload file to MEGA: ${error.message}`)
  }
}

/**
 * Download file from MEGA storage
 * @param fileHandle - MEGA file handle
 * @returns File buffer
 */
export async function downloadFileFromMega(fileHandle: string): Promise<Buffer> {
  try {
    const storage = await initializeMega()
    
    // Find file by handle (nodeId)
    // storage.files is an object with nodeId as keys, not an array
    const fileNode = storage.files[fileHandle] || Object.values(storage.files).find((file: any) => 
      file.nodeId === fileHandle || file.h === fileHandle
    )
    
    if (!fileNode) {
      throw new Error(`File not found in MEGA: ${fileHandle}`)
    }
    
    // Download file using downloadBuffer method (simpler than stream)
    const fileBuffer = await fileNode.downloadBuffer()
    
    return fileBuffer
  } catch (error: any) {
    console.error('[MEGA] Error downloading file:', error)
    throw new Error(`Failed to download file from MEGA: ${error.message}`)
  }
}

/**
 * Get file metadata from MEGA
 * @param fileHandle - MEGA file handle
 * @returns File metadata
 */
export async function getFileMetadata(fileHandle: string): Promise<{
  name: string
  size: number
  mimeType?: string
}> {
  try {
    const storage = await initializeMega()
    
    // Find file by handle (nodeId)
    // storage.files is an object with nodeId as keys, not an array
    const fileNode = storage.files[fileHandle] || Object.values(storage.files).find((file: any) => 
      file.nodeId === fileHandle || file.h === fileHandle
    )
    
    if (!fileNode) {
      throw new Error(`File not found in MEGA: ${fileHandle}`)
    }
    
    return {
      name: fileNode.name || 'unknown',
      size: fileNode.size || 0,
      mimeType: fileNode.attributes?.n?.mimeType,
    }
  } catch (error: any) {
    console.error('[MEGA] Error getting file metadata:', error)
    throw new Error(`Failed to get file metadata from MEGA: ${error.message}`)
  }
}

/**
 * Delete file from MEGA storage
 * @param fileHandle - MEGA file handle
 */
export async function deleteFileFromMega(fileHandle: string): Promise<void> {
  try {
    const storage = await initializeMega()
    
    // Find file by handle (nodeId)
    // storage.files is an object with nodeId as keys, not an array
    const fileNode = storage.files[fileHandle] || Object.values(storage.files).find((file: any) => 
      file.nodeId === fileHandle || file.h === fileHandle
    )
    
    if (!fileNode) {
      console.warn(`[MEGA] File not found for deletion: ${fileHandle}`)
      return
    }
    
    // Delete file
    await new Promise<void>((resolve, reject) => {
      fileNode.delete((error: Error | null) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
    
    console.log(`[MEGA] ✅ File deleted: ${fileHandle}`)
  } catch (error: any) {
    console.error('[MEGA] Error deleting file:', error)
    throw new Error(`Failed to delete file from MEGA: ${error.message}`)
  }
}

