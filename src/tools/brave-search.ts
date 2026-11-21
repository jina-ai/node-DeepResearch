import { BRAVE_API_KEY } from "../config";
import axiosClient from "../utils/axios-client";
import { logInfo } from '../logging';

import { BraveSearchResponse } from '../types';

export async function braveSearch(query: string): Promise<{ response: BraveSearchResponse }> {
  logInfo('Search info:', { query });

  const response = await axiosClient.get<BraveSearchResponse>('https://api.search.brave.com/res/v1/web/search', {
    params: {
      q: query,
      count: 10
    },
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': BRAVE_API_KEY
    },
    timeout: 10000
  });

  if (response.status !== 200) {
    throw new Error(`Brave search failed: ${response.status} ${response.statusText}`)
  }

  // Maintain the same return structure as the original code
  return { response: response.data };
}
