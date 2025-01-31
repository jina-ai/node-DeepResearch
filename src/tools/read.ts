import https from 'https';

interface ReadResponse {
  code: number;
  status: number;
  data: {
    title: string;
    description: string;
    url: string;
    content: string;
    usage: { tokens: number; };
  };
}

export function readUrl(url: string, token: string): Promise<{ response: ReadResponse, tokens: number }> {
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
        'X-Retain-Images': 'none'
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        const response = JSON.parse(responseData) as ReadResponse;
        console.debug('\x1b[36m%s\x1b[0m', 'Read intermediate result:', response);
        console.info('\x1b[32m%s\x1b[0m', 'Read final output:', {
          title: response.data.title,
          url: response.data.url,
          tokens: response.data.usage.tokens
        });
        resolve({ response, tokens: response.data?.usage?.tokens || 0 });
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
