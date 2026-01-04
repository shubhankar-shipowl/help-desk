import { google } from 'googleapis'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'

// Load Google Drive service account credentials
function getGoogleDriveCredentials() {
  try {
    const configPath = join(process.cwd(), 'config', 'media-storage-service.json')
    const fileContent = readFileSync(configPath, 'utf-8')
    const credentials = JSON.parse(fileContent)
    
    // Validate required fields
    if (!credentials.client_email) {
      throw new Error('Missing client_email in credentials')
    }
    if (!credentials.private_key) {
      throw new Error('Missing private_key in credentials')
    }
    if (!credentials.project_id) {
      throw new Error('Missing project_id in credentials')
    }
    
    console.log(`✅ Loaded Google Drive credentials for: ${credentials.client_email}`)
    return credentials
  } catch (error: any) {
    console.error('❌ Error loading Google Drive credentials:', error.message)
    if (error.code === 'ENOENT') {
      throw new Error('Google Drive credentials file not found. Please ensure config/media-storage-service.json exists.')
    }
    throw new Error(`Failed to load Google Drive credentials: ${error.message}`)
  }
}

// Initialize Google Drive client with proper authentication
async function getDriveClient() {
  try {
    const credentials = getGoogleDriveCredentials()
    
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file',
      ],
    })

    // Authorize the client before returning
    // This ensures the JWT token is generated and the client is authenticated
    console.log('🔐 Authorizing Google Drive client...')
    await auth.authorize()
    console.log('✅ Google Drive client authorized successfully')
    
    return google.drive({ version: 'v3', auth })
  } catch (error: any) {
    console.error('❌ Error initializing Google Drive client:', error.message)
    if (error.message?.includes('invalid_grant')) {
      throw new Error('Invalid service account credentials. Please check your config/media-storage-service.json file.')
    }
    if (error.message?.includes('unregistered callers')) {
      throw new Error('Service account not properly configured. Please ensure the Google Drive API is enabled and the service account has proper permissions.')
    }
    throw new Error(`Failed to initialize Google Drive client: ${error.message}`)
  }
}

/**
 * Upload a file to Google Drive and make it publicly accessible
 * @param fileBuffer - The file buffer to upload
 * @param fileName - The name of the file
 * @param mimeType - The MIME type of the file
 * @param folderId - Optional folder ID to upload to (if not provided, uploads to root)
 * @returns Public URL of the uploaded file
 */
export async function uploadFileToGoogleDrive(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  folderId?: string
): Promise<string> {
  try {
    const drive = await getDriveClient()

    // Prepare file metadata
    const fileMetadata: any = {
      name: fileName,
    }

    // If folderId is provided, add it to parents
    if (folderId) {
      fileMetadata.parents = [folderId]
    }

    // Convert Buffer to Readable stream (Google Drive API requires a stream)
    const stream = Readable.from(fileBuffer)
    
    // Upload file to Google Drive
    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType,
        body: stream,
      },
      fields: 'id, name, webViewLink, webContentLink',
    })

    const fileId = response.data.id
    if (!fileId) {
      throw new Error('Failed to get file ID from Google Drive')
    }

    // Make the file publicly accessible
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    })

    // Get the public URL
    // Use webContentLink for direct download or webViewLink for preview
    const publicUrl = response.data.webContentLink || response.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`

    console.log(`✅ File uploaded to Google Drive successfully:`)
    console.log(`   - File Name: ${fileName}`)
    console.log(`   - File ID: ${fileId}`)
    console.log(`   - Public URL: ${publicUrl}`)
    console.log(`   - MIME Type: ${mimeType}`)
    console.log(`   - Size: ${(fileBuffer.length / 1024).toFixed(2)} KB`)
    
    return publicUrl
  } catch (error: any) {
    console.error('Error uploading file to Google Drive:', error)
    throw new Error(`Failed to upload file to Google Drive: ${error.message}`)
  }
}

/**
 * Create a folder in Google Drive and make it publicly accessible
 * @param folderName - The name of the folder
 * @param parentFolderId - Optional parent folder ID (if not provided, creates in root)
 * @returns Folder ID
 */
export async function createFolderInGoogleDrive(
  folderName: string,
  parentFolderId?: string
): Promise<string> {
  try {
    const drive = await getDriveClient()

    const fileMetadata: any = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    }

    if (parentFolderId) {
      fileMetadata.parents = [parentFolderId]
    }

    const response = await drive.files.create({
      requestBody: fileMetadata,
      fields: 'id',
    })

    const folderId = response.data.id
    if (!folderId) {
      throw new Error('Failed to get folder ID from Google Drive')
    }

    // Make the folder publicly accessible
    await drive.permissions.create({
      fileId: folderId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    })

    console.log(`✅ Folder created in Google Drive: ${folderName} (ID: ${folderId})`)
    return folderId
  } catch (error: any) {
    console.error('Error creating folder in Google Drive:', error)
    throw new Error(`Failed to create folder in Google Drive: ${error.message}`)
  }
}

/**
 * Find or create a folder in Google Drive
 * @param folderName - The name of the folder to find or create
 * @param parentFolderId - Optional parent folder ID
 * @returns Folder ID
 */
export async function findOrCreateFolder(
  folderName: string,
  parentFolderId?: string
): Promise<string> {
  try {
    const drive = await getDriveClient()

    // Try to find existing folder
    let query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    if (parentFolderId) {
      query += ` and '${parentFolderId}' in parents`
    } else {
      query += ` and 'root' in parents`
    }

    const searchResponse = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      pageSize: 1,
    })

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      const folderId = searchResponse.data.files[0].id
      if (folderId) {
        console.log(`✅ Found existing folder: ${folderName} (ID: ${folderId})`)
        return folderId
      }
    }

    // Folder doesn't exist, create it
    return await createFolderInGoogleDrive(folderName, parentFolderId)
  } catch (error: any) {
    console.error('Error finding or creating folder:', error)
    throw new Error(`Failed to find or create folder: ${error.message}`)
  }
}

