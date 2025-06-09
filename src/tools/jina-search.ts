import { TokenTracker } from "../utils/token-tracker";
import { SearchResponse, SERPQuery } from '../types';
import { JINA_API_KEY } from "../config";
import axiosClient from '../utils/axios-client';

export async function search(
  query: SERPQuery,
  tracker?: TokenTracker
): Promise<{ response: SearchResponse }> {
  try {
    const { data } = await axiosClient.post<SearchResponse>(
      `https://s.jina.ai/`,
      query,
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${JINA_API_KEY}`,
          'X-Respond-With': 'no-content',
        },
        timeout: 10000,
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
      promptTokens: query.q.length,
      completionTokens: totalTokens
    });

    return { response: data };
  } catch (error) {
    console.error('Error in jina search:', error);
    throw error;
  }
}