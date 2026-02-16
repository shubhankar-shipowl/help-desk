import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

export interface HttpClientOptions {
  baseURL: string;
  timeout?: number;
  internalApiKey?: string;
  maxRetries?: number;
  baseRetryDelay?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error: any): boolean {
  if (!error.response) {
    // Network errors (ECONNREFUSED, ETIMEDOUT, etc.)
    return true;
  }
  const status = error.response?.status;
  // Retry on 502, 503, 504 (upstream/service unavailable)
  return status === 502 || status === 503 || status === 504;
}

export function createHttpClient(options: HttpClientOptions): AxiosInstance {
  const {
    baseURL,
    timeout = 30000,
    internalApiKey,
    maxRetries = 3,
    baseRetryDelay = 500,
  } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (internalApiKey) {
    headers['x-internal-api-key'] = internalApiKey;
  }

  const client = axios.create({
    baseURL,
    timeout,
    headers,
  });

  // Add retry interceptor
  client.interceptors.response.use(undefined, async (error) => {
    const config = error.config as AxiosRequestConfig & { _retryCount?: number };

    if (!config || !isRetryableError(error)) {
      return Promise.reject(error);
    }

    config._retryCount = config._retryCount || 0;

    if (config._retryCount >= maxRetries) {
      return Promise.reject(error);
    }

    config._retryCount += 1;
    const delay = baseRetryDelay * Math.pow(2, config._retryCount - 1);

    console.warn(
      `[HttpClient] Retrying ${config.method?.toUpperCase()} ${config.url} (attempt ${config._retryCount}/${maxRetries}) in ${delay}ms`
    );

    await sleep(delay);
    return client(config);
  });

  return client;
}
