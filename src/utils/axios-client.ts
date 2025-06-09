import axios, { AxiosRequestConfig } from 'axios';  

// Default timeout in milliseconds  
const DEFAULT_TIMEOUT = 30000;
  
// Maximum content length to prevent OOM issues (10MB)  
const MAX_CONTENT_LENGTH = 10 * 1024 * 1024;  
  
// Maximum number of redirects to follow  
const MAX_REDIRECTS = 5;

// Maximum number of sockets to keep open
const MAX_SOCKETS = 50;

// Maximum number of free sockets to keep open
const MAX_FREE_SOCKETS = 10;

// Keep-alive timeout in milliseconds
const KEEP_ALIVE_TIMEOUT = 30000;

// Scheduling strategy for HTTP/2 connections
// LIFO (Last In, First Out) is generally better for performance
const SCHEDULING = 'lifo';
  
// Base configuration for all axios instances  
const baseConfig: AxiosRequestConfig = {  
  timeout: DEFAULT_TIMEOUT,  
  maxContentLength: MAX_CONTENT_LENGTH,  
  maxRedirects: MAX_REDIRECTS,  
  httpsAgent: new (require('https').Agent)({
    maxSockets: MAX_SOCKETS,
    maxFreeSockets: MAX_FREE_SOCKETS,
    keepAlive: true,
    timeout: KEEP_ALIVE_TIMEOUT,
    scheduling: SCHEDULING,
  }),
  httpAgent: new (require('http').Agent)({
    maxSockets: MAX_SOCKETS,
    maxFreeSockets: MAX_FREE_SOCKETS,
    keepAlive: true,
    timeout: KEEP_ALIVE_TIMEOUT,
    scheduling: SCHEDULING,
  }),
  headers: {  
    'Accept': 'application/json',  
    'Content-Type': 'application/json',  
  },
};

// Create a single axios instance with the base configuration  
const axiosClient = axios.create(baseConfig);  
  
// Add response interceptor for consistent error handling  
axiosClient.interceptors.response.use(  
  (response) => response,  
  (error) => {
    if (error.code === 'ECONNABORTED') {
      console.error('Request timed out:', error.message);
      error.request?.destroy?.();
    }
    if (axios.isAxiosError(error)) {  
      if (error.response) {  
        const status = error.response.status;  
        const errorData = error.response.data as any;  
          
        if (status === 402) {  
          throw new Error(errorData?.readableMessage || 'Insufficient balance');  
        }  
        throw new Error(errorData?.readableMessage || `HTTP Error ${status}`);  
      } else if (error.request) {  
        throw new Error(`No response received from server`);  
      } else {  
        throw new Error(`Request failed: ${error.message}`);  
      }
    }
    throw error;  
  }
); 

export default axiosClient;