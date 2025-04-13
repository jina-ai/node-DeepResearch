import {segmentText} from './segment';
import {Reference, TrackerContext, WebContent} from "../types";
import {rerankDocuments} from "./jina-rerank";
import {Schemas} from "../utils/schemas";


export async function buildReferences(
  answer: string,
  webContents: Record<string, WebContent>,
  context: TrackerContext,
  schema: Schemas,
  maxRef: number = 6,
  minChunkLength: number = 50,
): Promise<{ answer: string, references: Array<Reference> }> {
  // Step 1: Chunk the answer
  const {chunks: answerChunks, chunk_positions: answerChunkPositions} = await segmentText(answer, context);

  // Step 2: Prepare all web content chunks, filtering out those below minimum length
  const allWebContentChunks = [];
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

    // Create a reranking task
    rerankTasks.push({
      index: i,
      chunk: answerChunk,
      position: answerChunkPosition,
      promise: rerankDocuments(answerChunk, allWebContentChunks, context.tokenTracker)
    });
  }

  // Run all reranking tasks in parallel
  const results = await Promise.all(rerankTasks.map(task => task.promise));

  // Process all results
  const allMatches = [];
  for (let i = 0; i < results.length; i++) {
    const task = rerankTasks[i];
    const {results: rerankResults} = results[i];

    // Add to matches list, filtering for valid web chunks
    for (const match of rerankResults) {
      // Only include matches where the web chunk is valid (above minimum length)
      if (validWebChunkIndices.has(match.index)) {
        allMatches.push({
          webChunkIndex: match.index,
          answerChunkIndex: task.index,
          relevanceScore: match.relevance_score,
          answerChunk: task.chunk,
          answerChunkPosition: task.position
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

    // Check if there's a newline at the end of the chunk and adjust position
    const chunkEndText = modifiedAnswer.substring(Math.max(0, insertPosition - 5), insertPosition);
    const newlineMatch = chunkEndText.match(/\n+$/);
    if (newlineMatch) {
      // Move the insertion position before the newline(s)
      insertPosition -= newlineMatch[0].length;
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