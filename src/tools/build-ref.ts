import {segmentText} from './segment';
import {Reference, TrackerContext, WebContent} from "../types";
import {rerankDocuments} from "./jina-rerank";
import {Schemas} from "../utils/schemas";

// New function to calculate Jaccard similarity as fallback
function calculateJaccardSimilarity(text1: string, text2: string): number {
  // Convert texts to lowercase and tokenize by splitting on non-alphanumeric characters
  const tokens1 = new Set(text1.toLowerCase().split(/\W+/).filter(t => t.length > 0));
  const tokens2 = new Set(text2.toLowerCase().split(/\W+/).filter(t => t.length > 0));

  // Calculate intersection size
  const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));

  // Calculate union size
  const union = new Set([...tokens1, ...tokens2]);

  // Return Jaccard similarity
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// New function to perform fallback similarity ranking
async function fallbackRerankWithJaccard(query: string, documents: string[]): Promise<{ results: { index: number, relevance_score: number }[] }> {
  const results = documents.map((doc, index) => {
    const score = calculateJaccardSimilarity(query, doc);
    return {index, relevance_score: score};
  });

  // Sort by score in descending order
  results.sort((a, b) => b.relevance_score - a.relevance_score);

  return {results};
}

export async function buildReferences(
  answer: string,
  webContents: Record<string, WebContent>,
  context: TrackerContext,
  schema: Schemas,
  maxRef: number = 6,
  minChunkLength: number = 80,
): Promise<{ answer: string, references: Array<Reference> }> {
  // Step 1: Chunk the answer
  const {chunks: answerChunks, chunk_positions: answerChunkPositions} = await segmentText(answer, context);

  // Step 2: Prepare all web content chunks, filtering out those below minimum length
  const allWebContentChunks: any = [];
  const chunkToSourceMap: any = {};  // Maps chunk index to source information
  const validWebChunkIndices = new Set(); // Tracks indices of valid web chunks

  let chunkIndex = 0;
  for (const [url, content] of Object.entries(webContents)) {
    if (!content.chunks || content.chunks.length === 0) continue;

    for (let i = 0; i < content.chunks.length; i++) {
      const chunk = content.chunks[i];
      allWebContentChunks.push(chunk);
      chunkToSourceMap[chunkIndex] = {
        url,
        title: content.title || url,
        text: chunk
      };

      // Track valid web chunks (above minimum length)
      if (chunk.length >= minChunkLength) {
        validWebChunkIndices.add(chunkIndex);
      }

      chunkIndex++;
    }
  }

  if (allWebContentChunks.length === 0) {
    return {answer, references: []};
  }

  // Step 3: Filter answer chunks by minimum length and create reranking tasks
  const validAnswerChunks = [];
  const rerankTasks = [];

  context.actionTracker.trackThink('cross_reference', schema.languageCode);

  for (let i = 0; i < answerChunks.length; i++) {
    const answerChunk = answerChunks[i];
    const answerChunkPosition = answerChunkPositions[i];

    // Skip empty chunks or chunks below minimum length
    if (!answerChunk.trim() || answerChunk.length < minChunkLength) continue;

    validAnswerChunks.push(i);

    // Create a reranking task (handling batch size constraint later)
    rerankTasks.push({
      index: i,
      chunk: answerChunk,
      position: answerChunkPosition
    });
  }

  // Fixed batch size of 512 as suggested
  const BATCH_SIZE = 512;

  // Process all reranking tasks in parallel with fixed batch size
  const processTaskWithBatches = async (task: any) => {
    try {
      // Create batches of web content chunks
      const batches = [];
      for (let i = 0; i < allWebContentChunks.length; i += BATCH_SIZE) {
        batches.push(allWebContentChunks.slice(i, i + BATCH_SIZE));
      }

      // Process all batches in parallel
      const batchPromises = batches.map(async (batch, batchIndex) => {
        const batchOffset = batchIndex * BATCH_SIZE;
        const result = await rerankDocuments(task.chunk, batch, context.tokenTracker);

        // Adjust indices to account for batching
        return result.results.map(item => ({
          index: item.index + batchOffset,
          relevance_score: item.relevance_score
        }));
      });

      // Wait for all batch processing to complete
      const batchResults = await Promise.all(batchPromises);

      // Combine and sort all results
      const combinedResults = batchResults.flat();
      combinedResults.sort((a, b) => b.relevance_score - a.relevance_score);

      return {
        answerChunkIndex: task.index,
        answerChunk: task.chunk,
        answerChunkPosition: task.position,
        results: combinedResults
      };
    } catch (error) {
      console.error('Reranking failed, falling back to Jaccard similarity', error);
      // Fallback to Jaccard similarity
      const fallbackResult = await fallbackRerankWithJaccard(task.chunk, allWebContentChunks);
      return {
        answerChunkIndex: task.index,
        answerChunk: task.chunk,
        answerChunkPosition: task.position,
        results: fallbackResult.results
      };
    }
  };

  // Process all tasks in parallel
  const taskResults = await Promise.all(rerankTasks.map(processTaskWithBatches));

  // Collect and flatten all matches
  const allMatches = [];
  for (const taskResult of taskResults) {
    for (const match of taskResult.results) {
      // Only include matches where the web chunk is valid (above minimum length)
      if (validWebChunkIndices.has(match.index)) {
        allMatches.push({
          webChunkIndex: match.index,
          answerChunkIndex: taskResult.answerChunkIndex,
          relevanceScore: match.relevance_score,
          answerChunk: taskResult.answerChunk,
          answerChunkPosition: taskResult.answerChunkPosition
        });
      }
    }
  }

  // Log statistics about relevance scores
  if (allMatches.length > 0) {
    const relevanceScores = allMatches.map(match => match.relevanceScore);
    const minRelevance = Math.min(...relevanceScores);
    const maxRelevance = Math.max(...relevanceScores);
    const sumRelevance = relevanceScores.reduce((sum, score) => sum + score, 0);
    const meanRelevance = sumRelevance / relevanceScores.length;

    console.log('Reference relevance statistics:', {
      min: minRelevance.toFixed(4),
      max: maxRelevance.toFixed(4),
      mean: meanRelevance.toFixed(4),
      count: relevanceScores.length
    });
  }

  // Step 4: Sort all matches by relevance
  allMatches.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Step 5: Filter to ensure each web content chunk AND answer chunk is used only once
  const usedWebChunks = new Set();
  const usedAnswerChunks = new Set();
  const filteredMatches = [];

  for (const match of allMatches) {
    if (!usedWebChunks.has(match.webChunkIndex) && !usedAnswerChunks.has(match.answerChunkIndex)) {
      filteredMatches.push(match);
      usedWebChunks.add(match.webChunkIndex);
      usedAnswerChunks.add(match.answerChunkIndex);

      // Break if we've reached the max number of references
      if (filteredMatches.length >= maxRef) break;
    }
  }

  // Step 6: Build reference objects
  const references: Reference[] = filteredMatches.map((match) => {
    const source = chunkToSourceMap[match.webChunkIndex];
    return {
      exactQuote: source.text,
      url: source.url,
      title: source.title,
      dateTime: source.dateTime,
      relevanceScore: match.relevanceScore,
      answerChunk: match.answerChunk,
      answerChunkPosition: match.answerChunkPosition
    };
  });

  // Step 7: Inject reference markers ([^1], [^2], etc.) into the answer
  let modifiedAnswer = answer;

  // Sort references by position in the answer (to insert markers in correct order)
  const referencesByPosition = [...references]
    .sort((a, b) => a.answerChunkPosition![0] - b.answerChunkPosition![0]);

// Insert markers from beginning to end, tracking offset
  let offset = 0;
  for (let i = 0; i < referencesByPosition.length; i++) {
    const ref = referencesByPosition[i];
    const marker = `[^${i + 1}]`;

    // Calculate position to insert the marker (end of the chunk + current offset)
    let insertPosition = ref.answerChunkPosition![1] + offset;

    // Check if there's a newline or table pipe at the end of the chunk and adjust position
    const chunkEndText = modifiedAnswer.substring(Math.max(0, insertPosition - 5), insertPosition);
    const newlineMatch = chunkEndText.match(/\n+$/);
    const tableEndMatch = chunkEndText.match(/\s*\|\s*$/);

    if (newlineMatch) {
      // Move the insertion position before the newline(s)
      insertPosition -= newlineMatch[0].length;
    } else if (tableEndMatch) {
      // Move the insertion position before the table end pipe
      insertPosition -= tableEndMatch[0].length;
    }

    // Insert the marker
    modifiedAnswer =
      modifiedAnswer.slice(0, insertPosition) +
      marker +
      modifiedAnswer.slice(insertPosition);

    // Update offset for subsequent insertions
    offset += marker.length;
  }
  return {
    answer: modifiedAnswer,
    references
  };
}