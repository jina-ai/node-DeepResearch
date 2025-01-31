import https from 'https';

interface SearchResponse {
  code: number;
  status: number;
  data: Array<{
    title: string;
    description: string;
    url: string;
    content: string;
    usage: { tokens: number; };
  }>;
}

export function search(query: string, token: string): Promise<{ response: SearchResponse, tokens: number }> {
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
        console.debug('\x1b[36m%s\x1b[0m', 'Search intermediate result:', response);
        console.info('\x1b[32m%s\x1b[0m', 'Search final output:', response.data.map(item => ({
          title: item.title,
          url: item.url,
          tokens: item.usage.tokens
        })));
        resolve({ response, tokens: totalTokens });
      });
    });

    req.on('error', reject);
    req.end();
  });
}
