import https from 'https';
import {TokenTracker} from "../utils/token-tracker";
import {ReadResponse} from '../types';
import {JINA_API_KEY} from "../config";

export function readUrl(url: string, withAllLinks?: boolean, tracker?: TokenTracker, withAllImages?: boolean): Promise<{ response: ReadResponse }> {
  return new Promise((resolve, reject) => {
    if (!url.trim()) {
      reject(new Error('URL cannot be empty'));
      return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      reject(new Error('Invalid URL, only http and https URLs are supported'));
      return;
    }

    const data = JSON.stringify({url});
    const headers: Record<string, any> = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${JINA_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Md-Link-Style': 'discarded',
    };
    if (withAllLinks) {
      headers['X-With-Links-Summary'] = 'all'
    }
    if (withAllImages) {
      headers['X-With-Images-Summary'] = 'true'
      headers['X-With-Generated-Alt'] = 'true'
    } else {
      headers['X-Retain-Images'] = 'none'
    }

    const options = {
      hostname: 'r.jina.ai',
      port: 443,
      path: '/',
      method: 'POST',
      headers
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => responseData += chunk);

      res.on('end', () => {
        // Check HTTP status code first
        if (res.statusCode && res.statusCode >= 400) {
          try {
            // Try to parse error message from response if available
            const errorResponse = JSON.parse(responseData);
            if (res.statusCode === 402) {
              reject(new Error(errorResponse.readableMessage || 'Insufficient balance'));
              return;
            }
            reject(new Error(errorResponse.readableMessage || `HTTP Error ${res.statusCode}`));
          } catch (error: unknown) {
            // If parsing fails, just return the status code
            reject(new Error(`HTTP Error ${res.statusCode}`));
          }
          return;
        }

        // Only parse JSON for successful responses
        let response: ReadResponse;
        try {
          response = JSON.parse(responseData) as ReadResponse;
        } catch (error: unknown) {
          reject(new Error(`Failed to parse response: ${error instanceof Error ? error.message : 'Unknown error'}`));
          return;
        }

        if (!response.data) {
          reject(new Error('Invalid response data'));
          return;
        }

        console.log('Read:', {
          title: response.data.title,
          url: response.data.url,
          tokens: response.data.usage?.tokens || 0
        });

        const tokens = response.data.usage?.tokens || 0;
        const tokenTracker = tracker || new TokenTracker();
        tokenTracker.trackUsage('read', {
          totalTokens: tokens,
          promptTokens: url.length,
          completionTokens: tokens
        });

        resolve({response});
      });
    });

    // Add timeout handling
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    req.on('error', (error: Error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });

    req.write(data);
    req.end();
  });
}