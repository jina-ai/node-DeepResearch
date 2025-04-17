import {JINA_API_KEY} from "../config";
import {JinaEmbeddingRequest, JinaEmbeddingResponse} from "../types";
import axios, {AxiosError} from "axios";

const BATCH_SIZE = 128;
const API_URL = "https://api.jina.ai/v1/embeddings";

// Modified to support different embedding tasks and dimensions
export async function getEmbeddings(
  texts: string[],
  tokenTracker?: any,
  options: {
    task?: "text-matching" | "retrieval.passage" | "retrieval.query",
    dimensions?: number,
    late_chunking?: boolean,
    embedding_type?: string
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

    const request: JinaEmbeddingRequest = {
      model: "jina-embeddings-v3",
      task: options.task || "text-matching",
      input: batchTexts,
      truncate: true
    };

    // Add optional parameters if provided
    if (options.dimensions) request.dimensions = options.dimensions;
    if (options.late_chunking) request.late_chunking = options.late_chunking;
    if (options.embedding_type) request.embedding_type = options.embedding_type;

    try {
      const response = await axios.post<JinaEmbeddingResponse>(
        API_URL,
        request,
        {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${JINA_API_KEY}`
          }
        }
      );

      // Prepare embeddings, handling any missing indices
      let batchEmbeddings: number[][];

      if (!response.data.data || response.data.data.length !== batchTexts.length) {
        console.error('Invalid response from Jina API:', response.data.data?.length, batchTexts.length);

        // Find missing indices and complete with zero vectors
        const receivedIndices = new Set(response.data.data?.map(item => item.index) || []);
        const dimensionSize = response.data.data?.[0]?.embedding?.length || options.dimensions || 1024;

        batchEmbeddings = [];

        for (let idx = 0; idx < batchTexts.length; idx++) {
          if (receivedIndices.has(idx)) {
            // Find the item with this index
            const item = response.data.data.find(d => d.index === idx);
            batchEmbeddings.push(item!.embedding);
          } else {
            // Create a zero vector for missing index
            console.error(`Missing embedding for index ${idx}: [${batchTexts[idx]}]`);
            batchEmbeddings.push(new Array(dimensionSize).fill(0));
          }
        }
      } else {
        // All indices present, just sort by index
        batchEmbeddings = response.data.data
          .sort((a, b) => a.index - b.index)
          .map(item => item.embedding);
      }

      allEmbeddings.push(...batchEmbeddings);
      totalTokens += response.data.usage?.total_tokens || 0;
      console.log(`[embeddings] Batch ${currentBatch} complete. Tokens used: ${response.data.usage?.total_tokens || 0}, total so far: ${totalTokens}`);

    } catch (error) {
      console.error('Error calling Jina Embeddings API:', error);
      if (error instanceof AxiosError && error.response?.status === 402) {
        return {embeddings: [], tokens: 0};
      }
      throw error;
    }
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
