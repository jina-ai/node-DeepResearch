import https from 'https';

interface BraveSearchResponse {
  web: {
    results: Array<{
      title: string;
      description: string;
      url: string;
    }>;
  };
}

export function braveSearch(query: string, token: string): Promise<{ response: BraveSearchResponse }> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.search.brave.com',
      port: 443,
      path: `/res/v1/web/search?q=${encodeURIComponent(query)}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': token
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        const response = JSON.parse(responseData) as BraveSearchResponse;
        console.log('Brave Search:', response.web.results.map(item => ({
          title: item.title,
          url: item.url
        })));
        resolve({ response });
      });
    });

    req.on('error', reject);
    req.end();
  });
}
