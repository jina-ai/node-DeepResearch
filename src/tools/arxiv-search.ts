import { TokenTracker } from "../utils/token-tracker";
import { ArxivSearchResponse, SERPQuery } from '../types';
import { JINA_API_KEY } from "../config";
import axiosClient from '../utils/axios-client';

export async function arxivSearch(
  query: SERPQuery,
  tracker?: TokenTracker
): Promise<{ response: ArxivSearchResponse }> {
  try {
    const { data } = await axiosClient.post<ArxivSearchResponse>(
      `https://svip.jina.ai/`,
      {
        q: query.q,
        domain: 'arxiv',
      },
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${JINA_API_KEY}`,
        },
        timeout: 10000,
        responseType: 'json'
      }
    );

    if (!data.results || !Array.isArray(data.results)) {
      throw new Error('Invalid response format');
    }


    console.log('Total URLs:', data.meta.num_results);

    const tokenTracker = tracker || new TokenTracker();
    tokenTracker.trackUsage('search', {
      totalTokens: data.meta.credits,
      promptTokens: query.q.length,
      completionTokens: 0
    });

    return { response: data };
  } catch (error) {
    console.error('Error in arxiv search:', error instanceof Error ? error.message : 'Unknown error occurred');
    throw new Error(error instanceof Error ? error.message : 'Unknown error occurred');
  }
}