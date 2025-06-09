import {SERPER_API_KEY} from "../config";
import axiosClient from "../utils/axios-client";

import {SerperSearchResponse, SERPQuery} from '../types';


export async function serperSearch(query: SERPQuery): Promise<{ response: SerperSearchResponse }> {
  const response = await axiosClient.post<SerperSearchResponse>('https://google.serper.dev/search', {
    ...query,
    autocorrect: false,
  }, {
    headers: {
      'X-API-KEY': SERPER_API_KEY,
      'Content-Type': 'application/json'
    },
    timeout: 10000
  });

  if (response.status !== 200) {
    throw new Error(`Serper search failed: ${response.status} ${response.statusText}`)
  }

  // Maintain the same return structure as the original code
  return {response: response.data};
}


export async function serperSearchOld(query: string): Promise<{ response: SerperSearchResponse }> {
  const response = await axiosClient.post<SerperSearchResponse>('https://google.serper.dev/search', {
    q: query,
    autocorrect: false,
  }, {
    headers: {
      'X-API-KEY': SERPER_API_KEY,
      'Content-Type': 'application/json'
    },
    timeout: 10000
  });

  if (response.status !== 200) {
    throw new Error(`Serper search failed: ${response.status} ${response.statusText}`)
  }

  // Maintain the same return structure as the original code
  return {response: response.data};
}
