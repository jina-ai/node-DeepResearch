import { TAVILY_API_KEY } from '../config';
import { SERPQuery, TavilySearchResponse } from '../types';
import axiosClient from '../utils/axios-client';
import { TokenTracker } from '../utils/token-tracker';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

const timeRangeByTbs: Record<string, string> = {
  'qdr:d': 'd',
  'qdr:w': 'w',
  'qdr:m': 'm',
  'qdr:y': 'y',
};

export async function tavilySearch(
  query: SERPQuery,
  tracker?: TokenTracker,
): Promise<{ response: TavilySearchResponse }> {
  if (!query.q.trim()) {
    throw new Error('Search query cannot be empty');
  }

  if (!TAVILY_API_KEY) {
    throw new Error('TAVILY_API_KEY not found');
  }

  const payload: Record<string, unknown> = {
    query: query.q,
    search_depth: 'basic',
    max_results: 20,
    include_answer: false,
    include_raw_content: false,
    include_usage: true,
  };

  const timeRange = query.tbs ? timeRangeByTbs[query.tbs] : undefined;
  if (timeRange) {
    payload.time_range = timeRange;
  }

  const { data } = await axiosClient.post<TavilySearchResponse>(TAVILY_SEARCH_URL, payload, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${TAVILY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  if (!data || !Array.isArray(data.results)) {
    throw new Error('Invalid Tavily search response');
  }

  const credits = data.usage?.credits || 0;
  if (tracker && credits > 0) {
    tracker.trackUsage('search', {
      totalTokens: credits,
      promptTokens: credits,
      completionTokens: 0,
    });
  }

  return { response: data };
}
