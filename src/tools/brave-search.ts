import {BRAVE_API_KEY} from "../config";
import axiosClient from "../utils/axios-client";

import { BraveSearchResponse } from '../types';

export async function braveSearch(query: string): Promise<{ response: BraveSearchResponse }> {
  const response = await axiosClient.get<BraveSearchResponse>('https://api.search.brave.com/res/v1/web/search', {
    params: {
      q: query,
      count: 10,
      safesearch: 'off'
    },
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': BRAVE_API_KEY
    },
    timeout: 10000
  });

  // Maintain the same return structure as the original code
  return { response: response.data };
}
