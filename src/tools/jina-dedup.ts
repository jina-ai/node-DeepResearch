import { logError, logInfo } from "../logging";
import { TokenTracker } from "../utils/token-tracker";
import { cosineSimilarity } from "./cosine";
import { getEmbeddings } from "./embeddings";

const SIMILARITY_THRESHOLD = 0.86; // Adjustable threshold for cosine similarity


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
    const { embeddings: allEmbeddings } = await getEmbeddings(allQueries, tracker);

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
    logInfo('Dedup:', { uniqueQueries });
    return {
      unique_queries: uniqueQueries,
    };
  } catch (error) {
    logError('Error in deduplication analysis:', { error });

    // return all new queries if there is an error
    return {
      unique_queries: newQueries,
    };
  }
}