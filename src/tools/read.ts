import https from 'https';
import { TokenTracker } from "../utils/token-tracker";

import { ReadResponse } from '../types';

export function readUrl(url: string, token: string, tracker?: TokenTracker): Promise<{ response: ReadResponse, tokens: number }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({url});

    const options = {
      hostname: 'r.jina.ai',
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'X-Retain-Images': 'none',
        'X-Return-Format': 'markdown'
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        const response = JSON.parse(responseData) as ReadResponse;
        console.log('Read:', {
          title: response.data.title,
          url: response.data.url,
          tokens: response.data.usage.tokens
        });
        const tokens = response.data?.usage?.tokens || 0;
        (tracker || new TokenTracker()).trackUsage('read', tokens);
        resolve({ response, tokens });
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
