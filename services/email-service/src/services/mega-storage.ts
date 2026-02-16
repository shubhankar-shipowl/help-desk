import { Storage } from 'megajs'

/**
 * MEGA Storage Service (Email Service copy)
 * Handles file uploads/downloads to MEGA cloud storage
 */

const folderCache = new Map<string, any>()

interface UploadResult {
  fileHandle: string
  fileUrl: string
  fileName: string
  fileSize: number
  mimeType: string
}

let megaStorage: any = null
let isInitialized = false
let initializationPromise: Promise<any> | null = null

const megaErrorHandler = (reason: any, _promise?: Promise<any>) => {
  const reasonMessage = String(reason?.message || '')

  const isOriginalCbError =
    reasonMessage === 'originalCb is not a function' ||
    (reason instanceof TypeError && reasonMessage.includes('originalCb'))

  if (isOriginalCbError) return

  const isEnoentError =
    reasonMessage.includes('ENOENT (-9)') ||
    reasonMessage.includes('Object (typically, node or user) not found')

  if (isEnoentError) {
    console.warn('[MEGA] File not found (ENOENT):', reasonMessage)
    return
  }

  console.error('Unhandled rejection:', reason)
}

if (typeof process !== 'undefined' && !(globalThis as any).__megaErrorHandlerRegistered) {
  (globalThis as any).__megaErrorHandlerRegistered = true
  process.on('unhandledRejection', megaErrorHandler)
}

async function initializeMega(): Promise<any> {
  if (isInitialized && megaStorage) return megaStorage

  if (initializationPromise) return initializationPromise

  const email = process.env.MEGA_EMAIL
  const password = process.env.MEGA_PASSWORD

  if (!email || !password) {
    throw new Error('MEGA credentials not configured. Set MEGA_EMAIL and MEGA_PASSWORD.')
  }

  initializationPromise = (async () => {
    try {
      megaStorage = new Storage({ email, password })

      await new Promise<void>((resolve, reject) => {
        megaStorage.once('ready', () => {
          console.log('[MEGA] Connected to MEGA storage')
          isInitialized = true
          resolve()
        })
        megaStorage.once('error', (error: Error) => {
          console.error('[MEGA] Connection error:', error)
          reject(error)
        })
      })

      return megaStorage
    } catch (error: any) {
      initializationPromise = null
      throw new Error(`Failed to initialize MEGA storage: ${error.message}`)
    }
  })()

  return initializationPromise
}

async function getOrCreateFolder(folderPath: string): Promise<any> {
  if (folderCache.has(folderPath)) return folderCache.get(folderPath)

  const storage = await initializeMega()
  const pathParts = folderPath.split('/').filter(Boolean)

  let currentFolder = storage.root
  let currentPath = ''

  for (const folderName of pathParts) {
    currentPath = currentPath ? `${currentPath}/${folderName}` : folderName

    if (folderCache.has(currentPath)) {
      currentFolder = folderCache.get(currentPath)
      continue
    }

    const existingFolder = currentFolder.children?.find(
      (child: any) => child.name === folderName && child.directory
    )

    if (existingFolder) {
      currentFolder = existingFolder
      folderCache.set(currentPath, currentFolder)
    } else {
      try {
        const newFolder = await storage.mkdir(folderName, currentFolder)
        console.log(`[MEGA] Created folder: ${currentPath}`)
        currentFolder = newFolder
        folderCache.set(currentPath, currentFolder)
      } catch (mkdirError: any) {
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

  folderCache.set(folderPath, currentFolder)
  return currentFolder
}

function getFolderForFileType(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'app-backups/help-desk/images'
  if (mimeType.startsWith('video/')) return 'app-backups/help-desk/videos'
  return 'app-backups/help-desk/images'
}

export async function uploadFileToMega(
  fileBuffer: Buffer, fileName: string, mimeType: string, ticketId?: string
): Promise<UploadResult> {
  try {
    const storage = await initializeMega()
    const folderPath = getFolderForFileType(mimeType)
    const targetFolder = await getOrCreateFolder(folderPath)

    const timestamp = Date.now()
    const randomId = Math.random().toString(36).substring(7)
    const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
    const uniqueFileName = ticketId
      ? `${ticketId}_${timestamp}_${randomId}_${sanitizedName}`
      : `${timestamp}_${randomId}_${sanitizedName}`

    const fileNode = await new Promise<any>((resolve, reject) => {
      try {
        const uploadStream = storage.upload({
          name: uniqueFileName, size: fileBuffer.length, target: targetFolder,
        }, fileBuffer)

        uploadStream.on('complete', (file: any) => resolve(file))
        uploadStream.on('error', (error: Error) => {
          if (error.message?.includes('originalCb')) {
            setTimeout(() => {
              const f = targetFolder.children?.find((c: any) => c.name === uniqueFileName && !c.directory)
              f ? resolve(f) : reject(error)
            }, 1000)
          } else reject(error)
        })

        setTimeout(() => {
          const f = targetFolder.children?.find((c: any) => c.name === uniqueFileName && !c.directory)
          if (f) resolve(f)
        }, 2000)
      } catch (error: any) {
        if (error.message?.includes('originalCb')) {
          setTimeout(async () => {
            await new Promise(r => setTimeout(r, 1000))
            const f = targetFolder.children?.find((c: any) => c.name === uniqueFileName && !c.directory)
            f ? resolve(f) : reject(error)
          }, 1000)
        } else reject(error)
      }
    })

    const fileHandle = fileNode.nodeId || fileNode.h || fileNode.handle
    if (!fileHandle) throw new Error('Failed to get file handle from MEGA')

    const fileUrl = `/api/storage/mega/${fileHandle}`

    console.log(`[MEGA] File uploaded: ${fileName} -> ${fileUrl}`)

    return { fileHandle, fileUrl, fileName: uniqueFileName, fileSize: fileBuffer.length, mimeType }
  } catch (error: any) {
    throw new Error(`Failed to upload file to MEGA: ${error.message}`)
  }
}

export async function uploadEmailAttachmentToMega(
  fileBuffer: Buffer, fileName: string, mimeType: string, emailId: string
): Promise<UploadResult> {
  try {
    const storage = await initializeMega()
    const folderPath = 'app-backups/help-desk/email-attachments'
    const targetFolder = await getOrCreateFolder(folderPath)

    const timestamp = Date.now()
    const randomId = Math.random().toString(36).substring(7)
    const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
    const uniqueFileName = `${emailId}_${timestamp}_${randomId}_${sanitizedName}`

    const fileNode = await new Promise<any>((resolve, reject) => {
      try {
        const uploadStream = storage.upload({
          name: uniqueFileName, size: fileBuffer.length, target: targetFolder,
        }, fileBuffer)

        uploadStream.on('complete', (file: any) => resolve(file))
        uploadStream.on('error', (error: Error) => {
          if (error.message?.includes('originalCb')) {
            setTimeout(() => {
              const f = targetFolder.children?.find((c: any) => c.name === uniqueFileName && !c.directory)
              f ? resolve(f) : reject(error)
            }, 1000)
          } else reject(error)
        })

        setTimeout(() => {
          const f = targetFolder.children?.find((c: any) => c.name === uniqueFileName && !c.directory)
          if (f) resolve(f)
        }, 2000)
      } catch (error: any) {
        if (error.message?.includes('originalCb')) {
          setTimeout(async () => {
            await new Promise(r => setTimeout(r, 1000))
            const f = targetFolder.children?.find((c: any) => c.name === uniqueFileName && !c.directory)
            f ? resolve(f) : reject(error)
          }, 1000)
        } else reject(error)
      }
    })

    const fileHandle = fileNode.nodeId || fileNode.h || fileNode.handle
    if (!fileHandle) throw new Error('Failed to get file handle from MEGA')

    const fileUrl = `/api/storage/mega/${fileHandle}`

    console.log(`[MEGA] Email attachment uploaded: ${fileName} -> ${fileUrl}`)

    return { fileHandle, fileUrl, fileName: uniqueFileName, fileSize: fileBuffer.length, mimeType }
  } catch (error: any) {
    throw new Error(`Failed to upload email attachment to MEGA: ${error.message}`)
  }
}

export async function downloadFileFromMega(fileHandle: string): Promise<Buffer> {
  try {
    const storage = await initializeMega()
    const fileNode = storage.files[fileHandle] || Object.values(storage.files).find((file: any) =>
      file.nodeId === fileHandle || file.h === fileHandle
    )
    if (!fileNode) throw new Error(`File not found in MEGA: ${fileHandle}`)
    return await fileNode.downloadBuffer()
  } catch (error: any) {
    throw new Error(`Failed to download file from MEGA: ${error.message}`)
  }
}

export async function getFileMetadata(fileHandle: string): Promise<{
  name: string; size: number; mimeType?: string
}> {
  try {
    const storage = await initializeMega()
    const fileNode = storage.files[fileHandle] || Object.values(storage.files).find((file: any) =>
      file.nodeId === fileHandle || file.h === fileHandle
    )
    if (!fileNode) throw new Error(`File not found in MEGA: ${fileHandle}`)
    return { name: fileNode.name || 'unknown', size: fileNode.size || 0, mimeType: fileNode.attributes?.n?.mimeType }
  } catch (error: any) {
    throw new Error(`Failed to get file metadata from MEGA: ${error.message}`)
  }
}

export async function deleteFileFromMega(fileHandle: string): Promise<void> {
  try {
    const storage = await initializeMega()
    const fileNode = storage.files[fileHandle] || Object.values(storage.files).find((file: any) =>
      file.nodeId === fileHandle || file.h === fileHandle
    )
    if (!fileNode) { console.warn(`[MEGA] File not found for deletion: ${fileHandle}`); return }
    await new Promise<void>((resolve, reject) => {
      fileNode.delete((error: Error | null) => { error ? reject(error) : resolve() })
    })
    console.log(`[MEGA] File deleted: ${fileHandle}`)
  } catch (error: any) {
    throw new Error(`Failed to delete file from MEGA: ${error.message}`)
  }
}
