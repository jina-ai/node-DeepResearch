import {JINA_API_KEY} from "../config";
import {JinaEmbeddingRequest, JinaEmbeddingResponse} from "../types";
import axiosClient from "../utils/axios-client";

const BATCH_SIZE = 128;
const API_URL = "https://api.jina.ai/v1/embeddings";
const MAX_RETRIES = 3; // Maximum number of retries for missing embeddings

// Modified to support different embedding tasks and dimensions
export async function getEmbeddings(
  texts: string[] | Record<string, string>[],
  tokenTracker?: any,
  options: {
    task?: "text-matching" | "retrieval.passage" | "retrieval.query",
    dimensions?: number,
    late_chunking?: boolean,
    embedding_type?: string,
    model?: string,
  } = {}
): Promise<{ embeddings: number[][], tokens: number }> {
  console.log(`[embeddings] Getting embeddings for ${texts.length} texts`);

  if (!JINA_API_KEY) {
    throw new Error('JINA_API_KEY is not set');
  }

  // Handle empty input case
  if (texts.length === 0) {
    return {embeddings: [], tokens: 0};
  }

  // Process in batches
  const allEmbeddings: number[][] = [];
  let totalTokens = 0;
  const batchCount = Math.ceil(texts.length / BATCH_SIZE);

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batchTexts = texts.slice(i, i + BATCH_SIZE);
    const currentBatch = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`[embeddings] Processing batch ${currentBatch}/${batchCount} (${batchTexts.length} texts)`);

    // Get embeddings for the batch with retry logic for missing indices
    const { batchEmbeddings, batchTokens } = await getBatchEmbeddingsWithRetry(
      batchTexts, 
      options,
      currentBatch,
      batchCount
    );

    allEmbeddings.push(...batchEmbeddings);
    totalTokens += batchTokens;
    console.log(`[embeddings] Batch ${currentBatch} complete. Tokens used: ${batchTokens}, total so far: ${totalTokens}`);
  }

  // Track token usage if tracker is provided
  if (tokenTracker) {
    tokenTracker.trackUsage('embeddings', {
      promptTokens: totalTokens,
      completionTokens: 0,
      totalTokens: totalTokens
    });
  }

  console.log(`[embeddings] Complete. Generated ${allEmbeddings.length} embeddings using ${totalTokens} tokens`);
  return {embeddings: allEmbeddings, tokens: totalTokens};
}

// Helper function to get embeddings for a batch with retry logic for missing indices
async function getBatchEmbeddingsWithRetry(
  batchTexts: string[] | Record<string, string>[],
  options: {
    task?: "text-matching" | "retrieval.passage" | "retrieval.query",
    dimensions?: number,
    late_chunking?: boolean,
    embedding_type?: string,
    model?: string,
  },
  currentBatch: number,
  batchCount: number
): Promise<{ batchEmbeddings: number[][], batchTokens: number }> {
  const batchEmbeddings: number[][] = [];
  let batchTokens = 0;
  let retryCount = 0;
  let textsToProcess = [...batchTexts]; // Copy the original texts
  let indexMap = new Map<number, number>(); // Map to keep track of original indices
  
  // Initialize indexMap with original indices
  textsToProcess.forEach((_, idx) => {
    indexMap.set(idx, idx);
  });

  while (textsToProcess.length > 0 && retryCount < MAX_RETRIES) {
    const request: JinaEmbeddingRequest = {
      model: options.model || "jina-embeddings-v3",
      input: textsToProcess as any,
    };

    if (request.model === "jina-embeddings-v3") {
      request.task = options.task || "text-matching";
      request.truncate = true;
    }

    // Add optional parameters if provided
    if (options.dimensions) request.dimensions = options.dimensions;
    if (options.late_chunking) request.late_chunking = options.late_chunking;
    if (options.embedding_type) request.embedding_type = options.embedding_type;

    try {
      const response = await axiosClient.post<JinaEmbeddingResponse>(
        API_URL,
        request,
        {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${JINA_API_KEY}`
          }
        }
      ); 

      if (!response.data.data) {
        console.error('No data returned from Jina API');
        if (retryCount === MAX_RETRIES - 1) {
          // On last retry, create placeholder embeddings
          const dimensionSize = options.dimensions || 1024;
          const placeholderEmbeddings = textsToProcess.map(text => {
            console.error(`Failed to get embedding after all retries: [${truncateInputString(text)}...]`);
            return new Array(dimensionSize).fill(0);
          });
          
          // Add embeddings in correct order
          for (let i = 0; i < textsToProcess.length; i++) {
            const originalIndex = indexMap.get(i)!;
            while (batchEmbeddings.length <= originalIndex) {
              batchEmbeddings.push([]);
            }
            batchEmbeddings[originalIndex] = placeholderEmbeddings[i];
          }
        }
        retryCount++;
        continue;
      }

      const receivedIndices = new Set(response.data.data.map(item => item.index));
      const dimensionSize = response.data.data[0]?.embedding?.length || options.dimensions || 1024;
      
      // Process successful embeddings
      const successfulEmbeddings: number[][] = [];
      const remainingTexts: (string | Record<string, string>)[] = [];
      const newIndexMap = new Map<number, number>();
      
      for (let idx = 0; idx < textsToProcess.length; idx++) {
        if (receivedIndices.has(idx)) {
          // Find the item with this index
          const item = response.data.data.find(d => d.index === idx)!;
          
          // Get the original index and store in the result array
          const originalIndex = indexMap.get(idx)!;
          while (batchEmbeddings.length <= originalIndex) {
            batchEmbeddings.push([]);
          }
          batchEmbeddings[originalIndex] = item.embedding;
          successfulEmbeddings.push(item.embedding);
        } else {
          // Add to retry list
          const newIndex = remainingTexts.length;
          newIndexMap.set(newIndex, indexMap.get(idx)!);
          remainingTexts.push(textsToProcess[idx]);
          console.log(`Missing embedding for index ${idx}, will retry: [${truncateInputString(textsToProcess[idx])}...]`);
        }
      }

      // Add tokens
      batchTokens += response.data.usage?.total_tokens || 0;
      
      // Update for next iteration
      textsToProcess = remainingTexts;
      indexMap = newIndexMap;
      
      // If all embeddings were successfully processed, break out of the loop
      if (textsToProcess.length === 0) {
        break;
      }
      
      // Increment retry count and log
      retryCount++;
      console.log(`[embeddings] Batch ${currentBatch}/${batchCount} - Retrying ${textsToProcess.length} texts (attempt ${retryCount}/${MAX_RETRIES})`);
    } catch (error: any) {
      console.error('Error calling Jina Embeddings API:', error);
      if (error.response?.status === 402 || error.message.includes('InsufficientBalanceError') || error.message.includes('insufficient balance')) {
        return { batchEmbeddings: [], batchTokens: 0 };
      }
      
      // On last retry, create placeholder embeddings
      if (retryCount === MAX_RETRIES - 1) {
        const dimensionSize = options.dimensions || 1024;
        for (let idx = 0; idx < textsToProcess.length; idx++) {
          const originalIndex = indexMap.get(idx)!;
          console.error(`Failed to get embedding after all retries for index ${originalIndex}: [${truncateInputString(textsToProcess[idx])}...]`);
          
          while (batchEmbeddings.length <= originalIndex) {
            batchEmbeddings.push([]);
          }
          batchEmbeddings[originalIndex] = new Array(dimensionSize).fill(0);
        }
      }
      
      retryCount++;
      if (retryCount < MAX_RETRIES) {
        console.log(`[embeddings] Batch ${currentBatch}/${batchCount} - Retry attempt ${retryCount}/${MAX_RETRIES} after error`);
        // Wait before retrying to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        throw error; // If we've exhausted retries, re-throw the error
      }
    }
  }
  
  // Handle any remaining missing embeddings after max retries
  if (textsToProcess.length > 0) {
    console.error(`[embeddings] Failed to get embeddings for ${textsToProcess.length} texts after ${MAX_RETRIES} retries`);
    const dimensionSize = options.dimensions || 1024;
    
    for (let idx = 0; idx < textsToProcess.length; idx++) {
      const originalIndex = indexMap.get(idx)!;
      console.error(`Creating zero embedding for index ${originalIndex} after all retries failed`);
      
      while (batchEmbeddings.length <= originalIndex) {
        batchEmbeddings.push([]);
      }
      batchEmbeddings[originalIndex] = new Array(dimensionSize).fill(0);
    }
  }
  
  return { batchEmbeddings, batchTokens };
}

function truncateInputString(input: string | Record<string, string>): string {
  if (typeof input === 'string') {
    return input.slice(0, 50);
  } else {
    return Object.values(input)[0].slice(0, 50);
  }
}