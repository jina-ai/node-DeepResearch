import axios, {AxiosError} from 'axios';
import {TokenTracker} from "../utils/token-tracker";
import {JINA_API_KEY} from "../config";

const JINA_API_URL = 'https://api.jina.ai/v1/embeddings';
const SIMILARITY_THRESHOLD = 0.86; // Adjustable threshold for cosine similarity

interface JinaApiConfig {
  MODEL: string;
  TASK?: string;
  DIMENSIONS: number;
  EMBEDDING_TYPE: string;
  LATE_CHUNKING?: boolean;
}

const JINA_CONFIGS: { [key: string]: JinaApiConfig } = {
  text: {
    MODEL: 'jina-embeddings-v3',
    TASK: 'text-matching',
    DIMENSIONS: 1024,
    EMBEDDING_TYPE: 'float',
    LATE_CHUNKING: false,
  },
  image: {
    MODEL: 'jina-clip-v2',
    DIMENSIONS: 512,
    EMBEDDING_TYPE: 'float',
  },
};

// Types for Jina API
interface JinaEmbeddingRequest {
  model: string;
  task?: string;
  late_chunking?: boolean;
  dimensions: number;
  embedding_type: string;
  input: Array<{ image?: string; text?: string } | string>;
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
async function getEmbeddings(queries: string[], type: 'text' | 'image'): Promise<{ embeddings: number[][], tokens: number }> {
  if (!JINA_API_KEY) {
    throw new Error('JINA_API_KEY is not set');
  }

  const config = JINA_CONFIGS[type];
  if (!config) {
    throw new Error(`Invalid embedding type: ${type}`);
  }

  const request: JinaEmbeddingRequest = {
    model: config.MODEL,
    task: config.TASK,
    late_chunking: config.LATE_CHUNKING,
    dimensions: config.DIMENSIONS,
    embedding_type: config.EMBEDDING_TYPE,
    input: type === 'text' ? queries : queries.map(query => ({ image: query })) ,
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
): Promise<{ unique_queries: string[] }> {
  try {
    // Quick return for single new query with no existing queries
    if (newQueries.length === 1 && existingQueries.length === 0) {
      return {
        unique_queries: newQueries,
      };
    }

    // Get embeddings for all queries in one batch
    const allQueries = [...newQueries, ...existingQueries];
    const {embeddings: allEmbeddings, tokens} = await getEmbeddings(allQueries, 'text');

    // If embeddings is empty (due to 402 error), return all new queries
    if (!allEmbeddings.length) {
      return {
        unique_queries: newQueries,
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
    (tracker || new TokenTracker()).trackUsage('dedup', {
        promptTokens: 0,
        completionTokens: tokens,
        totalTokens: tokens
    });
    console.log('Dedup:', uniqueQueries);
    return {
      unique_queries: uniqueQueries,
    };
  } catch (error) {
    console.error('Error in deduplication analysis:', error);

    // return all new queries if there is an error
    return {
      unique_queries: newQueries,
    };
  }
}


export async function dedupImages(
  newImages: string[], // Array of base64 image strings
  existingImages: string[], // Array of base64 image strings
  tracker?: TokenTracker
): Promise<{ unique_images: string[] }> {
  try {
    // Quick return for single new image with no existing images
    if (newImages.length === 1 && existingImages.length === 0) {
      return {
        unique_images: newImages,
      };
    }

    // Get embeddings for all images in one batch
    const allImages = [...newImages, ...existingImages];
    const { embeddings: allEmbeddings, tokens } = await getEmbeddings(allImages, 'image');

    // If embeddings is empty (due to 402 error), return all new images
    if (!allEmbeddings.length) {
      return {
        unique_images: newImages,
      };
    }

    // Split embeddings back into new and existing
    const newEmbeddings = allEmbeddings.slice(0, newImages.length);
    const existingEmbeddings = allEmbeddings.slice(newImages.length);

    const uniqueImages: string[] = [];
    const usedIndices = new Set<number>();

    // Compare each new image against existing images and already accepted images
    for (let i = 0; i < newImages.length; i++) {
      let isUnique = true;

      // Check against existing images
      for (let j = 0; j < existingImages.length; j++) {
        const similarity = cosineSimilarity(newEmbeddings[i], existingEmbeddings[j]);
        if (similarity >= SIMILARITY_THRESHOLD) {
          isUnique = false;
          break;
        }
      }

      // Check against already accepted images
      if (isUnique) {
        for (const usedIndex of usedIndices) {
          const similarity = cosineSimilarity(newEmbeddings[i], newEmbeddings[usedIndex]);
          if (similarity >= SIMILARITY_THRESHOLD) {
            isUnique = false;
            break;
          }
        }
      }

      // Add to unique images if passed all checks
      if (isUnique) {
        uniqueImages.push(newImages[i]);
        usedIndices.add(i);
      }
    }

    // Track token usage (may not be relevant for images)
    (tracker || new TokenTracker()).trackUsage('dedup_images', {
        promptTokens: 0,
        completionTokens: tokens,
        totalTokens: tokens
    });

    return {
      unique_images: uniqueImages,
    };
  } catch (error) {
    console.error('Error in image deduplication analysis:', error);

    // return all new images if there is an error
    return {
      unique_images: newImages,
    };
  }
}