import { Storage } from 'megajs';
import axios from 'axios';

interface UploadResult {
  fileHandle: string;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

const folderCache = new Map<string, any>();

let megaStorage: any = null;
let isInitialized = false;
let initializationPromise: Promise<any> | null = null;

const megaErrorHandler = (reason: any, _promise?: Promise<any>) => {
  const reasonMessage = String(reason?.message || '');

  const isOriginalCbError =
    reasonMessage === 'originalCb is not a function' ||
    (reason instanceof TypeError && reasonMessage.includes('originalCb'));

  if (isOriginalCbError) {
    return;
  }

  const isEnoentError =
    reasonMessage.includes('ENOENT (-9)') ||
    reasonMessage.includes('Object (typically, node or user) not found');

  if (isEnoentError) {
    console.warn('[MEGA] File not found (ENOENT) - file may have been deleted:', reasonMessage);
    return;
  }

  console.error('Unhandled rejection:', reason);
};

if (typeof process !== 'undefined' && !(globalThis as any).__megaErrorHandlerRegistered) {
  (globalThis as any).__megaErrorHandlerRegistered = true;
  process.on('unhandledRejection', megaErrorHandler);
}

async function initializeMega(): Promise<any> {
  if (isInitialized && megaStorage) {
    return megaStorage;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  const email = process.env.MEGA_EMAIL;
  const password = process.env.MEGA_PASSWORD;

  if (!email || !password) {
    throw new Error('MEGA credentials not configured. Please set MEGA_EMAIL and MEGA_PASSWORD environment variables.');
  }

  initializationPromise = (async () => {
    try {
      megaStorage = new Storage({ email, password });

      await new Promise<void>((resolve, reject) => {
        megaStorage.once('ready', () => {
          console.log('[MEGA] Connected to MEGA storage');
          isInitialized = true;
          resolve();
        });

        megaStorage.once('error', (error: Error) => {
          console.error('[MEGA] Connection error:', error);
          reject(error);
        });
      });

      return megaStorage;
    } catch (error: any) {
      console.error('[MEGA] Failed to initialize:', error);
      initializationPromise = null;
      throw new Error(`Failed to initialize MEGA storage: ${error.message}`);
    }
  })();

  return initializationPromise;
}

async function getOrCreateFolder(folderPath: string): Promise<any> {
  if (folderCache.has(folderPath)) {
    return folderCache.get(folderPath);
  }

  const storage = await initializeMega();
  const pathParts = folderPath.split('/').filter(Boolean);

  let currentFolder = storage.root;
  let currentPath = '';

  for (const folderName of pathParts) {
    currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;

    if (folderCache.has(currentPath)) {
      currentFolder = folderCache.get(currentPath);
      continue;
    }

    const existingFolder = currentFolder.children?.find(
      (child: any) => child.name === folderName && child.directory
    );

    if (existingFolder) {
      currentFolder = existingFolder;
      folderCache.set(currentPath, currentFolder);
    } else {
      try {
        const newFolder = await storage.mkdir(folderName, currentFolder);
        console.log(`[MEGA] Created folder: ${currentPath}`);
        currentFolder = newFolder;
        folderCache.set(currentPath, currentFolder);
      } catch (mkdirError: any) {
        await new Promise(resolve => setTimeout(resolve, 500));
        const retryFolder = currentFolder.children?.find(
          (child: any) => child.name === folderName && child.directory
        );
        if (retryFolder) {
          currentFolder = retryFolder;
          folderCache.set(currentPath, currentFolder);
        } else {
          throw mkdirError;
        }
      }
    }
  }

  folderCache.set(folderPath, currentFolder);
  return currentFolder;
}

/**
 * Upload call recording to MEGA storage
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

    let authenticatedUrl = recordingUrl;

    if (!recordingUrl.includes('@')) {
      const urlObj = new URL(recordingUrl);
      authenticatedUrl = `${urlObj.protocol}//${apiKey}:${apiToken}@${urlObj.host}${urlObj.pathname}${urlObj.search}`;
    }

    const response = await axios.get(authenticatedUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
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

    let extension = '.mp3';
    if (contentType.includes('wav')) {
      extension = '.wav';
    } else if (contentType.includes('ogg')) {
      extension = '.ogg';
    }

    const storage = await initializeMega();

    const folderPath = 'app-backups/help-desk/call-recordings';
    const targetFolder = await getOrCreateFolder(folderPath);

    const timestamp = Date.now();
    const uniqueFileName = `${callSid}_${timestamp}${extension}`;

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

    const fileHandle = fileNode.nodeId || fileNode.h || fileNode.handle;
    if (!fileHandle) {
      throw new Error('Failed to get file handle from MEGA');
    }

    const fileUrl = `/api/storage/mega/${fileHandle}`;

    console.log(`[MEGA] Call recording uploaded:`);
    console.log(`   - Call SID: ${callSid}`);
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
