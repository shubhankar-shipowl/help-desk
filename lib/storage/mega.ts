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

// Cache for created folders to avoid repeated API calls
const folderCache = new Map<string, any>()

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
let initializationPromise: Promise<any> | null = null

// Suppress known megajs internal callback errors (uploads still succeed)
// This is a known issue with megajs library's internal callback handling
const megaErrorHandler = (reason: any, _promise?: Promise<any>) => {
  const isOriginalCbError = 
    reason?.message === 'originalCb is not a function' ||
    (reason instanceof TypeError && String(reason.message || '').includes('originalCb'))
  
  if (isOriginalCbError) {
    // Known megajs internal error - ignore silently as uploads succeed
    // This happens due to internal callback handling in megajs
    return
  }
  
  // Log other unhandled rejections (don't re-throw as it would cause process crash)
  console.error('Unhandled rejection:', reason)
}

// Register handler only once (check for existing handler)
if (typeof process !== 'undefined' && !(globalThis as any).__megaErrorHandlerRegistered) {
  (globalThis as any).__megaErrorHandlerRegistered = true
  process.on('unhandledRejection', megaErrorHandler)
}

/**
 * Initialize MEGA storage connection
 */
async function initializeMega(): Promise<any> {
  if (isInitialized && megaStorage) {
    return megaStorage
  }

  // Prevent multiple simultaneous initialization attempts
  if (initializationPromise) {
    return initializationPromise
  }

  const email = process.env.MEGA_EMAIL
  const password = process.env.MEGA_PASSWORD

  if (!email || !password) {
    throw new Error('MEGA credentials not configured. Please set MEGA_EMAIL and MEGA_PASSWORD environment variables.')
  }

  initializationPromise = (async () => {
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
      initializationPromise = null
      throw new Error(`Failed to initialize MEGA storage: ${error.message}`)
    }
  })()

  return initializationPromise
}

/**
 * Get or create folder in MEGA
 * @param folderPath - Path like "help-desk/images" or "help-desk/videos"
 * @returns Folder node
 */
async function getOrCreateFolder(folderPath: string): Promise<any> {
  // Check cache first
  if (folderCache.has(folderPath)) {
    return folderCache.get(folderPath)
  }
  
  const storage = await initializeMega()
  const pathParts = folderPath.split('/').filter(Boolean)
  
  let currentFolder = storage.root
  let currentPath = ''
  
  for (const folderName of pathParts) {
    currentPath = currentPath ? `${currentPath}/${folderName}` : folderName
    
    // Check cache for partial path
    if (folderCache.has(currentPath)) {
      currentFolder = folderCache.get(currentPath)
      continue
    }
    
    // Check if folder exists in children
    const existingFolder = currentFolder.children?.find(
      (child: any) => child.name === folderName && child.directory
    )
    
    if (existingFolder) {
      currentFolder = existingFolder
      folderCache.set(currentPath, currentFolder)
    } else {
      // Create new folder - using simple await with try-catch
      try {
        const newFolder = await storage.mkdir(folderName, currentFolder)
        console.log(`[MEGA] 📁 Created folder: ${currentPath}`)
        currentFolder = newFolder
        folderCache.set(currentPath, currentFolder)
      } catch (mkdirError: any) {
        // If mkdir fails, check if folder was actually created (race condition)
        await new Promise(resolve => setTimeout(resolve, 500))
        const retryFolder = currentFolder.children?.find(
          (child: any) => child.name === folderName && child.directory
        )
        if (retryFolder) {
          currentFolder = retryFolder
          folderCache.set(currentPath, currentFolder)
        } else {
          throw mkdirError
        }
      }
    }
  }
  
  // Cache the final path
  folderCache.set(folderPath, currentFolder)
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
    // Handle megajs internal callback errors gracefully
    const fileNode = await new Promise<any>((resolve, reject) => {
      try {
        const uploadStream = storage.upload({
          name: uniqueFileName,
          size: fileBuffer.length,
          target: targetFolder,
        }, fileBuffer)
        
        uploadStream.on('complete', (file: any) => {
          resolve(file)
        })
        
        uploadStream.on('error', (error: Error) => {
          // Ignore known megajs internal callback errors (uploads still succeed)
          if (error.message && error.message.includes('originalCb')) {
            // Wait a bit and check if file was actually uploaded
            setTimeout(() => {
              // Try to find the uploaded file
              const uploadedFile = targetFolder.children?.find(
                (child: any) => child.name === uniqueFileName && !child.directory
              )
              if (uploadedFile) {
                resolve(uploadedFile)
              } else {
                reject(error)
              }
            }, 1000)
          } else {
            reject(error)
          }
        })
        
        // Fallback: Check if file was uploaded after a delay (handles megajs quirks)
        setTimeout(() => {
          const uploadedFile = targetFolder.children?.find(
            (child: any) => child.name === uniqueFileName && !child.directory
          )
          if (uploadedFile) {
            resolve(uploadedFile)
          }
        }, 2000)
      } catch (error: any) {
        // Catch synchronous errors
        if (error.message && error.message.includes('originalCb')) {
          // Known megajs internal error - check if file was uploaded anyway
          setTimeout(async () => {
            try {
              await new Promise(resolve => setTimeout(resolve, 1000))
              const uploadedFile = targetFolder.children?.find(
                (child: any) => child.name === uniqueFileName && !child.directory
              )
              if (uploadedFile) {
                resolve(uploadedFile)
              } else {
                reject(error)
              }
            } catch {
              reject(error)
            }
          }, 1000)
        } else {
          reject(error)
        }
      }
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
 * Upload email attachment to MEGA storage
 * Stores in dedicated 'help-desk/email-attachments' folder
 * @param fileBuffer - File buffer to upload
 * @param fileName - Original file name
 * @param mimeType - MIME type of the file
 * @param emailId - Email ID for organization
 * @returns Upload result with file handle and internal URL
 */
export async function uploadEmailAttachmentToMega(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  emailId: string
): Promise<UploadResult> {
  try {
    const storage = await initializeMega()
    
    // Use dedicated folder for email attachments
    const folderPath = 'help-desk/email-attachments'
    const targetFolder = await getOrCreateFolder(folderPath)
    
    // Generate unique filename with email reference
    const timestamp = Date.now()
    const randomId = Math.random().toString(36).substring(7)
    const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
    const uniqueFileName = `${emailId}_${timestamp}_${randomId}_${sanitizedName}`
    
    // Upload file to MEGA
    // Wrap in try-catch to handle megajs internal callback errors gracefully
    const fileNode = await new Promise<any>((resolve, reject) => {
      try {
        const uploadStream = storage.upload({
          name: uniqueFileName,
          size: fileBuffer.length,
          target: targetFolder,
        }, fileBuffer)
        
        uploadStream.on('complete', (file: any) => {
          resolve(file)
        })
        
        uploadStream.on('error', (error: Error) => {
          // Ignore known megajs internal callback errors (uploads still succeed)
          if (error.message && error.message.includes('originalCb')) {
            // Wait a bit and check if file was actually uploaded
            setTimeout(() => {
              // Try to find the uploaded file
              const uploadedFile = targetFolder.children?.find(
                (child: any) => child.name === uniqueFileName && !child.directory
              )
              if (uploadedFile) {
                resolve(uploadedFile)
              } else {
                reject(error)
              }
            }, 1000)
          } else {
            reject(error)
          }
        })
        
        // Handle case where upload completes but 'complete' event doesn't fire
        // (known megajs quirk)
        setTimeout(() => {
          const uploadedFile = targetFolder.children?.find(
            (child: any) => child.name === uniqueFileName && !child.directory
          )
          if (uploadedFile) {
            resolve(uploadedFile)
          }
        }, 2000)
      } catch (error: any) {
        // Catch synchronous errors
        if (error.message && error.message.includes('originalCb')) {
          // Known megajs internal error - check if file was uploaded anyway
          setTimeout(async () => {
            try {
              await new Promise(resolve => setTimeout(resolve, 1000))
              const uploadedFile = targetFolder.children?.find(
                (child: any) => child.name === uniqueFileName && !child.directory
              )
              if (uploadedFile) {
                resolve(uploadedFile)
              } else {
                reject(error)
              }
            } catch {
              reject(error)
            }
          }, 1000)
        } else {
          reject(error)
        }
      }
    })
    
    // Get file handle
    const fileHandle = fileNode.nodeId || fileNode.h || fileNode.handle
    if (!fileHandle) {
      throw new Error('Failed to get file handle from MEGA')
    }
    
    // Create internal URL for serving files
    const fileUrl = `/api/storage/mega/${fileHandle}`
    
    console.log(`[MEGA] ✅ Email attachment uploaded:`)
    console.log(`   - File: ${fileName}`)
    console.log(`   - Folder: ${folderPath}`)
    console.log(`   - Size: ${(fileBuffer.length / 1024).toFixed(2)} KB`)
    
    return {
      fileHandle,
      fileUrl,
      fileName: uniqueFileName,
      fileSize: fileBuffer.length,
      mimeType,
    }
  } catch (error: any) {
    console.error('[MEGA] Error uploading email attachment:', error)
    throw new Error(`Failed to upload email attachment to MEGA: ${error.message}`)
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
 * Upload call recording to MEGA storage
 * Downloads from Exotel with authentication and stores in MEGA
 * @param recordingUrl - Exotel recording URL
 * @param callSid - Exotel call SID for naming
 * @param exotelConfig - Exotel API credentials
 * @returns Upload result with file handle and internal URL
 */
export async function uploadCallRecordingToMega(
  recordingUrl: string,
  callSid: string,
  exotelConfig: {
    apiKey: string;
    apiToken: string;
  }
): Promise<UploadResult | null> {
  try {
    const { apiKey, apiToken } = exotelConfig;

    if (!recordingUrl) {
      console.log('[MEGA] No recording URL provided');
      return null;
    }

    console.log(`[MEGA] Downloading recording from Exotel: ${callSid}`);

    // Download recording from Exotel with authentication
    // Exotel recordings require API auth, so we add credentials to the URL
    let authenticatedUrl = recordingUrl;

    // Check if URL already has auth
    if (!recordingUrl.includes('@')) {
      // Add authentication to URL
      // Format: https://apiKey:apiToken@recordings.exotel.com/...
      const urlObj = new URL(recordingUrl);
      authenticatedUrl = `${urlObj.protocol}//${apiKey}:${apiToken}@${urlObj.host}${urlObj.pathname}${urlObj.search}`;
    }

    // Import axios dynamically to avoid circular dependencies
    const axios = (await import('axios')).default;

    const response = await axios.get(authenticatedUrl, {
      responseType: 'arraybuffer',
      timeout: 60000, // 60 second timeout for large recordings
      headers: {
        'Accept': 'audio/mpeg, audio/wav, audio/mp3, */*',
      },
    });

    if (!response.data || response.data.length === 0) {
      console.error('[MEGA] Empty recording data received');
      return null;
    }

    const fileBuffer = Buffer.from(response.data);
    const contentType = response.headers['content-type'] || 'audio/mpeg';

    // Determine file extension
    let extension = '.mp3';
    if (contentType.includes('wav')) {
      extension = '.wav';
    } else if (contentType.includes('ogg')) {
      extension = '.ogg';
    }

    const fileName = `recording_${callSid}${extension}`;

    console.log(`[MEGA] Recording downloaded: ${(fileBuffer.length / 1024).toFixed(2)} KB`);

    // Upload to MEGA
    const storage = await initializeMega();

    // Use dedicated folder for call recordings
    const folderPath = 'help-desk/call-recordings';
    const targetFolder = await getOrCreateFolder(folderPath);

    // Generate unique filename
    const timestamp = Date.now();
    const uniqueFileName = `${callSid}_${timestamp}${extension}`;

    // Upload file to MEGA
    const fileNode = await new Promise<any>((resolve, reject) => {
      try {
        const uploadStream = storage.upload({
          name: uniqueFileName,
          size: fileBuffer.length,
          target: targetFolder,
        }, fileBuffer);

        uploadStream.on('complete', (file: any) => {
          resolve(file);
        });

        uploadStream.on('error', (error: Error) => {
          if (error.message && error.message.includes('originalCb')) {
            setTimeout(() => {
              const uploadedFile = targetFolder.children?.find(
                (child: any) => child.name === uniqueFileName && !child.directory
              );
              if (uploadedFile) {
                resolve(uploadedFile);
              } else {
                reject(error);
              }
            }, 1000);
          } else {
            reject(error);
          }
        });

        // Fallback check
        setTimeout(() => {
          const uploadedFile = targetFolder.children?.find(
            (child: any) => child.name === uniqueFileName && !child.directory
          );
          if (uploadedFile) {
            resolve(uploadedFile);
          }
        }, 2000);
      } catch (error: any) {
        if (error.message && error.message.includes('originalCb')) {
          setTimeout(async () => {
            try {
              await new Promise(resolve => setTimeout(resolve, 1000));
              const uploadedFile = targetFolder.children?.find(
                (child: any) => child.name === uniqueFileName && !child.directory
              );
              if (uploadedFile) {
                resolve(uploadedFile);
              } else {
                reject(error);
              }
            } catch {
              reject(error);
            }
          }, 1000);
        } else {
          reject(error);
        }
      }
    });

    // Get file handle
    const fileHandle = fileNode.nodeId || fileNode.h || fileNode.handle;
    if (!fileHandle) {
      throw new Error('Failed to get file handle from MEGA');
    }

    // Create internal URL for serving files
    const fileUrl = `/api/storage/mega/${fileHandle}`;

    console.log(`[MEGA] ✅ Call recording uploaded:`);
    console.log(`   - Call SID: ${callSid}`);
    console.log(`   - Folder: ${folderPath}`);
    console.log(`   - Size: ${(fileBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`   - URL: ${fileUrl}`);

    return {
      fileHandle,
      fileUrl,
      fileName: uniqueFileName,
      fileSize: fileBuffer.length,
      mimeType: contentType,
    };
  } catch (error: any) {
    console.error('[MEGA] Error uploading call recording:', error.message);
    return null;
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

