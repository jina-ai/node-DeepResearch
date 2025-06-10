import { TokenTracker } from "../utils/token-tracker";
import { JinaSearchResponse, SERPQuery } from '../types';
import { JINA_API_KEY } from "../config";
import axiosClient from '../utils/axios-client';

export async function search(
  query: SERPQuery,
  domain?: string,
  num?: number,
  tracker?: TokenTracker
): Promise<{ response: JinaSearchResponse }> {
  try {
    if (domain !== 'arxiv') {
      domain = undefined;  // default to general search
    }

    const { data } = await axiosClient.post<JinaSearchResponse>(
      `https://svip.jina.ai/`,
      {
        ...query,
        domain,
        num
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

    console.log('Search results meta:', data.meta);

    const tokenTracker = tracker || new TokenTracker();
    tokenTracker.trackUsage('search', {
      totalTokens: data.meta.credits,
      promptTokens: query.q.length,
      completionTokens: 0
    });

    return { response: data };
  } catch (error) {
    console.error('Error in jina search:', error);
    throw error;
  }
}