import axios from 'axios';
import { TokenTracker } from "../utils/token-tracker";
import { SearchResponse } from '../types';
import { JINA_API_KEY } from "../config";

export async function search(
  query: string,
  tracker?: TokenTracker
): Promise<{ response: SearchResponse }> {
  if (!query.trim()) {
    throw new Error('Query cannot be empty');
  }

  try {
    const { data } = await axios.get<SearchResponse>(
      `https://s.jina.ai/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${JINA_API_KEY}`,
          'X-Respond-With': 'no-content',
        },
        timeout: 30000,
        responseType: 'json'
      }
    );

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Invalid response format');
    }

    const totalTokens = data.data.reduce(
      (sum, item) => sum + (item.usage?.tokens || 0),
      0
    );

    console.log('Total URLs:', data.data.length);

    const tokenTracker = tracker || new TokenTracker();
    tokenTracker.trackUsage('search', {
      totalTokens,
      promptTokens: query.length,
      completionTokens: totalTokens
    });

    return { response: data };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        const status = error.response.status;
        const errorData = error.response.data as any;

        if (status === 402) {
          throw new Error(errorData?.readableMessage || 'Insufficient balance');
        }
        throw new Error(errorData?.readableMessage || `HTTP Error ${status}`);
      } else if (error.request) {
        throw new Error('No response received from server');
      } else {
        throw new Error(`Request failed: ${error.message}`);
      }
    }
    throw error;
  }
}