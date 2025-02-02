import https from 'https';
import { TokenTracker } from "../utils/token-tracker";

import { SearchResponse } from '../types';

export function search(query: string, token: string, tracker?: TokenTracker): Promise<{ response: SearchResponse, tokens: number }> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 's.jina.ai',
      port: 443,
      path: `/${encodeURIComponent(query)}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Retain-Images': 'none'
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        const response = JSON.parse(responseData) as SearchResponse;
        const totalTokens = response.data.reduce((sum, item) => sum + (item.usage?.tokens || 0), 0);
        console.log('Search:', response.data.map(item => ({
          title: item.title,
          url: item.url,
          tokens: item.usage.tokens
        })));
        (tracker || new TokenTracker()).trackUsage('search', totalTokens);
        resolve({ response, tokens: totalTokens });
      });
    });

    req.on('error', reject);
    req.end();
  });
}
