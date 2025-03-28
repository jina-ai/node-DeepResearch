import axios from 'axios';
import {TokenTracker} from "../utils/token-tracker";
import {JINA_API_KEY} from "../config";

const JINA_API_URL = 'https://api.jina.ai/v1/rerank';

// Types for Jina Rerank API
interface JinaRerankRequest {
  model: string;
  query: string;
  top_n: number;
  documents: string[] | Record<string, string>[];
}

export interface JinaRerankResponse {
  model: string;
  results: Array<{
    index: number;
    document: {
      text: string;
      bytes: string;
    };
    relevance_score: number;
  }>;
  usage: {
    total_tokens: number;
  };
}

/**
 * Reranks a list of documents based on relevance to a query
 * @param query The query to rank documents against
 * @param documents Array of documents to be ranked
 * @param topN Number of top results to return
 * @param tracker Optional token tracker for usage monitoring
 * @returns Array of reranked documents with their scores
 */
export async function rerankDocuments(
  query: string,
  documents: string[],
  tracker?: TokenTracker
): Promise<{ results: Array<{index: number, relevance_score: number, document: {text: string}}> }> {
  try {
    if (!JINA_API_KEY) {
      throw new Error('JINA_API_KEY is not set');
    }

    const request: JinaRerankRequest = {
      model: 'jina-reranker-v2-base-multilingual',
      query,
      top_n: documents.length,
      documents
    };

    const response = await axios.post<JinaRerankResponse>(
      JINA_API_URL,
      request,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${JINA_API_KEY}`
        }
      }
    );

    // Track token usage from the API
    (tracker || new TokenTracker()).trackUsage('rerank', {
      promptTokens: response.data.usage.total_tokens,
      completionTokens: 0,
      totalTokens: response.data.usage.total_tokens
    });

    return {
      results: response.data.results
    };
  } catch (error) {
    console.error('Error in reranking documents:', error);

    // Return empty results if there is an error
    return {
      results: []
    };
  }
}

export async function rerankImages(
  query: string,
  documents: Record<string, string>[],
  tracker?: TokenTracker,
  top_n?: number,
): Promise<{ results: Array<{index: number, relevance_score: number, document: {bytes: string}}> }> {
  try {
    if (!JINA_API_KEY) {
      throw new Error('JINA_API_KEY is not set');
    }

    const request: JinaRerankRequest = {
      model: 'jina-reranker-v3',
      query,
      top_n: top_n ?? documents.length,
      documents
    };

    const response = await axios.post<JinaRerankResponse>(
      'https://jina-reranker-v3-dev-366646433082.us-central1.run.app/v1/rerank',
      request,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${JINA_API_KEY}`
        }
      }
    );

    // Track token usage from the API
    (tracker || new TokenTracker()).trackUsage('rerank', {
      promptTokens: response.data.usage.total_tokens,
      completionTokens: 0,
      totalTokens: response.data.usage.total_tokens
    });

    return {
      results: response.data.results
    };
  } catch (error) {
    console.error('Error in reranking documents:', error);

    // Return empty results if there is an error
    return {
      results: []
    };
  }
}