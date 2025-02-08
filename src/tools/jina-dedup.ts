import axios, { AxiosError } from 'axios';
import { TokenTracker } from "../utils/token-tracker";
import {JINA_API_KEY} from "../config";

const JINA_API_URL = 'https://api.jina.ai/v1/embeddings';
const SIMILARITY_THRESHOLD = 0.93; // Adjustable threshold for cosine similarity

const JINA_API_CONFIG = {
  MODEL: 'jina-embeddings-v3',
  TASK: 'text-matching',
  DIMENSIONS: 1024,
  EMBEDDING_TYPE: 'float',
  LATE_CHUNKING: false
} as const;

// Types for Jina API
interface JinaEmbeddingRequest {
  model: string;
  task: string;
  late_chunking: boolean;
  dimensions: number;
  embedding_type: string;
  input: string[];
}

interface JinaEmbeddingResponse {
  model: string;
  object: string;
  usage: {
    total_tokens: number;
    prompt_tokens: number;
  };
  data: Array<{
    object: string;
    index: number;
    embedding: number[];
  }>;
}


// Compute cosine similarity between two vectors
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (normA * normB);
}

// Get embeddings for all queries in one batch
async function getEmbeddings(queries: string[]): Promise<{ embeddings: number[][], tokens: number }> {
  if (!JINA_API_KEY) {
    throw new Error('JINA_API_KEY is not set');
  }

  const request: JinaEmbeddingRequest = {
    model: JINA_API_CONFIG.MODEL,
    task: JINA_API_CONFIG.TASK,
    late_chunking: JINA_API_CONFIG.LATE_CHUNKING,
    dimensions: JINA_API_CONFIG.DIMENSIONS,
    embedding_type: JINA_API_CONFIG.EMBEDDING_TYPE,
    input: queries
  };

  try {
    const response = await axios.post<JinaEmbeddingResponse>(
      JINA_API_URL,
      request,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${JINA_API_KEY}`
        }
      }
    );

    // Validate response format
    if (!response.data.data || response.data.data.length !== queries.length) {
      console.error('Invalid response from Jina API:', response.data);
      return {
        embeddings: [],
        tokens: 0
      };
    }

    // Sort embeddings by index to maintain original order
    const embeddings = response.data.data
      .sort((a, b) => a.index - b.index)
      .map(item => item.embedding);

    return {
      embeddings,
      tokens: response.data.usage.total_tokens
    };
  } catch (error) {
    console.error('Error getting embeddings from Jina:', error);
    if (error instanceof AxiosError && error.response?.status === 402) {
      return {
        embeddings: [],
        tokens: 0
      };
    }
    throw error;
  }
}

export async function dedupQueries(
  newQueries: string[],
  existingQueries: string[],
  tracker?: TokenTracker
): Promise<{ unique_queries: string[], tokens: number }> {
  try {
    // Quick return for single new query with no existing queries
    if (newQueries.length === 1 && existingQueries.length === 0) {
      console.log('Dedup (quick return):', newQueries);
      return {
        unique_queries: newQueries,
        tokens: 0  // No tokens used since we didn't call the API
      };
    }

    // Get embeddings for all queries in one batch
    const allQueries = [...newQueries, ...existingQueries];
    const { embeddings: allEmbeddings, tokens } = await getEmbeddings(allQueries);

    // If embeddings is empty (due to 402 error), return all new queries
    if (!allEmbeddings.length) {
      console.log('Dedup (no embeddings):', newQueries);
      return {
        unique_queries: newQueries,
        tokens: 0
      };
    }

    // Split embeddings back into new and existing
    const newEmbeddings = allEmbeddings.slice(0, newQueries.length);
    const existingEmbeddings = allEmbeddings.slice(newQueries.length);

    const uniqueQueries: string[] = [];
    const usedIndices = new Set<number>();

    // Compare each new query against existing queries and already accepted queries
    for (let i = 0; i < newQueries.length; i++) {
      let isUnique = true;

      // Check against existing queries
      for (let j = 0; j < existingQueries.length; j++) {
        const similarity = cosineSimilarity(newEmbeddings[i], existingEmbeddings[j]);
        if (similarity >= SIMILARITY_THRESHOLD) {
          isUnique = false;
          break;
        }
      }

      // Check against already accepted queries
      if (isUnique) {
        for (const usedIndex of usedIndices) {
          const similarity = cosineSimilarity(newEmbeddings[i], newEmbeddings[usedIndex]);
          if (similarity >= SIMILARITY_THRESHOLD) {
            isUnique = false;
            break;
          }
        }
      }

      // Add to unique queries if passed all checks
      if (isUnique) {
        uniqueQueries.push(newQueries[i]);
        usedIndices.add(i);
      }
    }

    // Track token usage from the API
    (tracker || new TokenTracker()).trackUsage('dedup', tokens);
    console.log('Dedup:', uniqueQueries);
    return {
      unique_queries: uniqueQueries,
      tokens
    };
  } catch (error) {
    console.error('Error in deduplication analysis:', error);
    throw error;
  }
}
