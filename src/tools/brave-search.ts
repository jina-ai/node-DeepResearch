import axios from 'axios';
import {BRAVE_API_KEY} from "../config";

interface BraveSearchResponse {
  web: {
    results: Array<{
      title: string;
      description: string;
      url: string;
    }>;
  };
}

export async function braveSearch(query: string): Promise<{ response: BraveSearchResponse }> {
  const response = await axios.get<BraveSearchResponse>('https://api.search.brave.com/res/v1/web/search', {
    params: {
      q: query,
      count: 5,
      safesearch: 'off'
    },
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': BRAVE_API_KEY
    },
    timeout: 10000
  });

  // Keep the same console.log as the original code
  console.log('Brave Search:', response.data.web.results.map(item => ({
    title: item.title,
    url: item.url
  })));

  // Maintain the same return structure as the original code
  return { response: response.data };
}