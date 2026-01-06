import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink, readFile } from 'fs/promises'
import { join } from 'path'
import { Storage } from 'megajs'
import { tmpdir } from 'os'

const execAsync = promisify(exec)

/**
 * Database Backup Service
 * Creates MySQL database backup and uploads to MEGA storage
 */

interface BackupConfig {
  databaseUrl: string
  megaEmail: string
  megaPassword: string
  backupFolder: string
}

/**
 * Parse DATABASE_URL to extract connection details
 * Format: mysql://user:password@host:port/database
 */
function parseDatabaseUrl(url: string): {
  user: string
  password: string
  host: string
  port: number
  database: string
} {
  try {
    const urlObj = new URL(url)
    // Decode password in case it's URL-encoded
    const password = decodeURIComponent(urlObj.password)
    return {
      user: decodeURIComponent(urlObj.username),
      password: password,
      host: urlObj.hostname,
      port: urlObj.port ? parseInt(urlObj.port, 10) : 3306,
      database: urlObj.pathname.replace('/', ''),
    }
  } catch (error) {
    throw new Error(`Invalid DATABASE_URL format: ${error}`)
  }
}

/**
 * Initialize MEGA storage connection
 */
async function initializeMega(email: string, password: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const storage = new Storage({ email, password })
    
    storage.once('ready', () => {
      console.log('[Backup] ✅ Connected to MEGA storage')
      resolve(storage)
    })
    
    storage.once('error', (error: Error) => {
      console.error('[Backup] ❌ MEGA connection error:', error)
      reject(error)
    })
  })
}

/**
 * Get or create folder in MEGA
 */
async function getOrCreateFolder(storage: any, folderPath: string): Promise<any> {
  const pathParts = folderPath.split('/').filter(Boolean)
  let currentFolder = storage.root
  
  for (const folderName of pathParts) {
    const existingFolder = currentFolder.children?.find(
      (child: any) => child.name === folderName && child.directory
    )
    
    if (existingFolder) {
      currentFolder = existingFolder
    } else {
      const newFolder = await storage.mkdir(folderName, currentFolder)
      console.log(`[Backup] 📁 Created folder: ${folderPath}`)
      currentFolder = newFolder
    }
  }
  
  return currentFolder
}

/**
 * Create database backup using mysqldump
 */
async function createDatabaseBackup(config: {
  user: string
  password: string
  host: string
  port: number
  database: string
}): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                    new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, '-')
  const backupFileName = `backup_${timestamp}.sql`
  const backupFilePath = join(tmpdir(), backupFileName)
  
  console.log(`[Backup] 📦 Creating database backup: ${backupFileName}`)
  console.log(`[Backup] 🔌 Connecting to: ${config.host}:${config.port}/${config.database}`)
  
  // Create a temporary MySQL config file for secure password handling
  // This avoids password in command line and handles special characters
  const configFilePath = join(tmpdir(), `mysql_config_${Date.now()}.cnf`)
  const configContent = `[client]
host=${config.host}
port=${config.port}
user=${config.user}
password=${config.password}
`
  
  try {
    // Write config file
    await writeFile(configFilePath, configContent, { mode: 0o600 }) // Read/write for owner only
    
    // Build mysqldump command using config file
    const mysqldumpCmd = `mysqldump --defaults-file="${configFilePath}" ${config.database} > "${backupFilePath}"`
    
    // Execute mysqldump
    await execAsync(mysqldumpCmd)
    
    // Clean up config file immediately after use
    await unlink(configFilePath).catch(() => {
      // Ignore cleanup errors
    })
    
    console.log(`[Backup] ✅ Database backup created: ${backupFilePath}`)
    return backupFilePath
  } catch (error: any) {
    // Clean up config file on error
    await unlink(configFilePath).catch(() => {
      // Ignore cleanup errors
    })
    
    console.error('[Backup] ❌ Failed to create database backup:', error.message)
    throw new Error(`Database backup failed: ${error.message}`)
  }
}

/**
 * Compress backup file using gzip
 */
async function compressBackup(filePath: string): Promise<string> {
  const compressedPath = `${filePath}.gz`
  console.log(`[Backup] 🗜️  Compressing backup...`)
  
  try {
    await execAsync(`gzip -c ${filePath} > ${compressedPath}`)
    console.log(`[Backup] ✅ Backup compressed: ${compressedPath}`)
    return compressedPath
  } catch (error: any) {
    console.error('[Backup] ❌ Failed to compress backup:', error.message)
    throw new Error(`Compression failed: ${error.message}`)
  }
}

/**
 * Upload backup file to MEGA
 */
async function uploadToMega(
  storage: any,
  filePath: string,
  fileName: string,
  folderPath: string
): Promise<void> {
  console.log(`[Backup] ☁️  Uploading backup to MEGA: ${fileName}`)
  
  try {
    // Read file buffer
    const fileBuffer = await readFile(filePath)
    
    // Get or create backup folder
    const targetFolder = await getOrCreateFolder(storage, folderPath)
    
    // Upload file to MEGA
    await new Promise<void>((resolve, reject) => {
      const uploadStream = storage.upload({
        name: fileName,
        size: fileBuffer.length,
        target: targetFolder,
      }, fileBuffer)
      
      uploadStream.on('complete', () => {
        console.log(`[Backup] ✅ Backup uploaded successfully: ${fileName}`)
        console.log(`[Backup] 📍 Location: ${folderPath}/${fileName}`)
        resolve()
      })
      
      uploadStream.on('error', (error: Error) => {
        reject(error)
      })
    })
  } catch (error: any) {
    console.error('[Backup] ❌ Failed to upload backup:', error.message)
    throw new Error(`MEGA upload failed: ${error.message}`)
  }
}

/**
 * Clean up temporary files
 */
async function cleanupFiles(filePaths: string[]): Promise<void> {
  for (const filePath of filePaths) {
    try {
      await unlink(filePath)
      console.log(`[Backup] 🗑️  Cleaned up: ${filePath}`)
    } catch (error: any) {
      console.warn(`[Backup] ⚠️  Failed to delete ${filePath}:`, error.message)
    }
  }
}

/**
 * Main backup function
 */
export async function backupDatabase(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  const megaEmail = process.env.MEGA_EMAIL
  const megaPassword = process.env.MEGA_PASSWORD
  // Remove leading slash if present for MEGA folder path
  const backupFolder = 'app-backups/help-desk'
  
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set')
  }
  
  if (!megaEmail || !megaPassword) {
    throw new Error('MEGA_EMAIL and MEGA_PASSWORD environment variables are not set')
  }
  
  let storage: any = null
  let backupFilePath: string | null = null
  let compressedFilePath: string | null = null
  
  try {
    console.log('[Backup] 🚀 Starting database backup process...')
    
    // Parse database URL
    const dbConfig = parseDatabaseUrl(databaseUrl)
    
    // Initialize MEGA storage
    storage = await initializeMega(megaEmail, megaPassword)
    
    // Create database backup
    backupFilePath = await createDatabaseBackup(dbConfig)
    
    // Compress backup
    compressedFilePath = await compressBackup(backupFilePath)
    
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                      new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, '-')
    const fileName = `backup_${timestamp}.sql.gz`
    
    // Upload to MEGA
    await uploadToMega(storage, compressedFilePath, fileName, backupFolder)
    
    console.log('[Backup] ✅ Database backup completed successfully!')
    
  } catch (error: any) {
    console.error('[Backup] ❌ Backup failed:', error.message)
    throw error
  } finally {
    // Clean up temporary files
    const filesToCleanup: string[] = []
    if (backupFilePath) filesToCleanup.push(backupFilePath)
    if (compressedFilePath) filesToCleanup.push(compressedFilePath)
    await cleanupFiles(filesToCleanup)
  }
}

