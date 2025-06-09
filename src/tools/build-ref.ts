import {segmentText} from './segment';
import {ImageObject, ImageReference, Reference, TrackerContext, WebContent} from "../types";
import {Schemas} from "../utils/schemas";
import {cosineSimilarity, jaccardRank} from "./cosine";
import {getEmbeddings} from "./embeddings";
import { dedupImagesWithEmbeddings } from '../utils/image-tools';
import {normalizeHostName} from '../utils/url-tools';

export async function buildReferences(
  answer: string,
  webContents: Record<string, WebContent>,
  context: TrackerContext,
  schema: Schemas,
  minChunkLength: number = 80,
  maxRef: number = 10,
  minRelScore: number = 0.7,
  onlyHostnames: string[] = []
): Promise<{ answer: string, references: Array<Reference> }> {
  console.log(`[buildReferences] Starting with maxRef=${maxRef}, minChunkLength=${minChunkLength}, minRelScore=${minRelScore}`);
  console.log(`[buildReferences] Answer length: ${answer.length} chars, Web content sources: ${Object.keys(webContents).length}`);

  // Step 1: Chunk the answer
  console.log(`[buildReferences] Step 1: Chunking answer text`);
  const {chunks: answerChunks, chunk_positions: answerChunkPositions} = await segmentText(answer, context);
  console.log(`[buildReferences] Answer segmented into ${answerChunks.length} chunks`);

  // Step 2: Prepare all web content chunks, filtering out those below minimum length
  console.log(`[buildReferences] Step 2: Preparing web content chunks and filtering by minimum length (${minChunkLength} chars)`);
  const allWebContentChunks: string[] = [];
  const chunkToSourceMap: any = {};  // Maps chunk index to source information
  const validWebChunkIndices = new Set<number>(); // Tracks indices of valid web chunks (those above minimum length)

  let chunkIndex = 0;
  for (const [url, content] of Object.entries(webContents)) {
    if (!content.chunks || content.chunks.length === 0) continue;
    if (onlyHostnames.length > 0 && !onlyHostnames.includes(normalizeHostName(url))) continue;

    for (let i = 0; i < content.chunks.length; i++) {
      const chunk = content.chunks[i];
      allWebContentChunks.push(chunk);
      chunkToSourceMap[chunkIndex] = {
        url,
        title: content.title || url,
        text: chunk,
      };

      // Track valid web chunks (above minimum length)
      if (chunk?.length >= minChunkLength) {
        validWebChunkIndices.add(chunkIndex);
      }

      chunkIndex++;
    }
  }

  console.log(`[buildReferences] Collected ${allWebContentChunks.length} web chunks, ${validWebChunkIndices.size} above minimum length`);

  if (allWebContentChunks.length === 0) {
    console.log(`[buildReferences] No web content chunks available, returning without references`);
    return {answer, references: []};
  }

  // Step 3: Filter answer chunks by minimum length
  console.log(`[buildReferences] Step 3: Filtering answer chunks by minimum length`);
  const validAnswerChunks: string[] = [];
  const validAnswerChunkIndices: number[] = [];
  const validAnswerChunkPositions: [number, number][] = [];

  context.actionTracker.trackThink('cross_reference', schema.languageCode);

  for (let i = 0; i < answerChunks.length; i++) {
    const answerChunk = answerChunks[i];
    const answerChunkPosition = answerChunkPositions[i];

    // Skip empty chunks or chunks below minimum length
    if (!answerChunk.trim() || answerChunk.length < minChunkLength) continue;

    validAnswerChunks.push(answerChunk);
    validAnswerChunkIndices.push(i);
    validAnswerChunkPositions.push(answerChunkPosition);
  }

  console.log(`[buildReferences] Found ${validAnswerChunks.length}/${answerChunks.length} valid answer chunks above minimum length`);

  if (validAnswerChunks.length === 0) {
    console.log(`[buildReferences] No valid answer chunks, returning without references`);
    return {answer, references: []};
  }

  // Step 4: Get embeddings for BOTH answer chunks and valid web chunks in a single request
  console.log(`[buildReferences] Step 4: Getting embeddings for all chunks in a single request (only including web chunks above min length)`);

  // Create maps to track the original indices
  const chunkIndexMap = new Map<number, { type: 'answer' | 'web', originalIndex: number }>();

  // Combine all chunks into a single array for embedding
  const allChunks: string[] = [];

  // Add answer chunks first
  validAnswerChunks.forEach((chunk, index) => {
    allChunks.push(chunk);
    chunkIndexMap.set(allChunks.length - 1, {type: 'answer', originalIndex: index});
  });

  // Then add web chunks that meet minimum length requirement
  for (let i = 0; i < allWebContentChunks.length; i++) {
    // Only include valid web chunks (those above minimum length)
    if (validWebChunkIndices.has(i)) {
      allChunks.push(allWebContentChunks[i]);
      chunkIndexMap.set(allChunks.length - 1, {type: 'web', originalIndex: i});
    }
  }

  console.log(`[buildReferences] Requesting embeddings for ${allChunks.length} total chunks (${validAnswerChunks.length} answer + ${validWebChunkIndices.size} web)`);

  try {
    // Get embeddings for all chunks in one request
    const embeddingsResult = await getEmbeddings(allChunks, context.tokenTracker);
    const allEmbeddings = embeddingsResult.embeddings;

    // Separate the embeddings back into answer and web chunks
    const answerEmbeddings: number[][] = [];
    const webEmbeddingMap = new Map<number, number[]>(); // Maps original web chunk index to embedding

    // Sort embeddings back to their original collections
    for (let i = 0; i < allEmbeddings.length; i++) {
      const embedding = allEmbeddings[i];
      const mapping = chunkIndexMap.get(i);

      if (mapping) {
        if (mapping.type === 'answer') {
          answerEmbeddings[mapping.originalIndex] = embedding;
        } else {
          webEmbeddingMap.set(mapping.originalIndex, embedding);
        }
      }
    }

    console.log(`[buildReferences] Successfully generated and separated embeddings: ${answerEmbeddings.length} answer, ${webEmbeddingMap.size} web`);

    // Step 5: Compute pairwise cosine similarity
    console.log(`[buildReferences] Step 5: Computing pairwise cosine similarity between answer and web chunks`);
    const allMatches = [];

    for (let i = 0; i < validAnswerChunks.length; i++) {
      const answerChunkIndex = validAnswerChunkIndices[i];
      const answerChunk = validAnswerChunks[i];
      const answerChunkPosition = validAnswerChunkPositions[i];
      const answerEmbedding = answerEmbeddings[i];

      const matchesForChunk = [];

      // Compute similarity with each valid web content chunk
      // All web chunks in webEmbeddingMap are already pre-filtered to be above minimum length
      for (const webChunkIndex of validWebChunkIndices) {
        const webEmbedding = webEmbeddingMap.get(webChunkIndex);

        if (webEmbedding) {
          const score = cosineSimilarity(answerEmbedding, webEmbedding);

          matchesForChunk.push({
            webChunkIndex,
            relevanceScore: score
          });
        }
      }

      // Sort by relevance score and take the top matches
      matchesForChunk.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Add the top matches to all matches with answerChunk information
      for (const match of matchesForChunk) {
        allMatches.push({
          webChunkIndex: match.webChunkIndex,
          answerChunkIndex: answerChunkIndex,
          relevanceScore: match.relevanceScore,
          answerChunk: answerChunk,
          answerChunkPosition: answerChunkPosition
        });
      }

      console.log(`[buildReferences] Processed answer chunk ${i + 1}/${validAnswerChunks.length}, top score: ${matchesForChunk[0]?.relevanceScore.toFixed(4)}`);
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

    // Step 6: Sort all matches by relevance
    allMatches.sort((a, b) => b.relevanceScore - a.relevanceScore);
    console.log(`[buildReferences] Step 6: Sorted ${allMatches.length} potential matches by relevance score`);

    // Step 7: Filter matches as before
    console.log(`[buildReferences] Step 7: Filtering matches to ensure uniqueness and threshold (min: ${minRelScore})`);
    const usedWebChunks = new Set();
    const usedAnswerChunks = new Set();
    const filteredMatches = [];

    for (const match of allMatches) {
      // Only consider matches with relevance score >= minRelScore
      if (match.relevanceScore < minRelScore) continue;

      if (!usedWebChunks.has(match.webChunkIndex) && !usedAnswerChunks.has(match.answerChunkIndex)) {
        filteredMatches.push(match);
        usedWebChunks.add(match.webChunkIndex);
        usedAnswerChunks.add(match.answerChunkIndex);

        // Break if we've reached the max number of references
        if (filteredMatches.length >= maxRef) break;
      }
    }

    console.log(`[buildReferences] Selected ${filteredMatches.length}/${allMatches.length} references after filtering`);
    return buildFinalResult(answer, filteredMatches, chunkToSourceMap);

  } catch (error) {
    console.error('Embedding failed, falling back to Jaccard similarity', error);
    console.log(`[buildReferences] Fallback: Using Jaccard similarity instead of embeddings`);

    // Process all chunks with Jaccard fallback
    const allMatches = [];

    for (let i = 0; i < validAnswerChunks.length; i++) {
      const answerChunk = validAnswerChunks[i];
      const answerChunkIndex = validAnswerChunkIndices[i];
      const answerChunkPosition = validAnswerChunkPositions[i];

      console.log(`[buildReferences] Processing answer chunk ${i + 1}/${validAnswerChunks.length} with Jaccard similarity`);
      const fallbackResult = await jaccardRank(answerChunk, allWebContentChunks);

      for (const match of fallbackResult.results) {
        if (validWebChunkIndices.has(match.index)) {
          allMatches.push({
            webChunkIndex: match.index,
            answerChunkIndex: answerChunkIndex,
            relevanceScore: match.relevance_score,
            answerChunk: answerChunk,
            answerChunkPosition: answerChunkPosition
          });
        }
      }
    }

    // Sort all matches by relevance and continue with the rest of the function
    allMatches.sort((a, b) => b.relevanceScore - a.relevanceScore);
    console.log(`[buildReferences] Fallback complete. Found ${allMatches.length} potential matches`);

    // Filter matches as before
    const usedWebChunks = new Set();
    const usedAnswerChunks = new Set();
    const filteredMatches = [];

    for (const match of allMatches) {
      if (!usedWebChunks.has(match.webChunkIndex) && !usedAnswerChunks.has(match.answerChunkIndex)) {
        // Check if the relevance score meets the minimum threshold
        if (match.relevanceScore >= minRelScore) {
          filteredMatches.push(match);
          usedWebChunks.add(match.webChunkIndex);
          usedAnswerChunks.add(match.answerChunkIndex);

          // Break if we've reached the max number of references
          if (filteredMatches.length >= maxRef) break;
        }
      }
    }

    console.log(`[buildReferences] Selected ${filteredMatches.length} references using fallback method`);
    return buildFinalResult(answer, filteredMatches, chunkToSourceMap);
  }
}

// Helper function to build the final result
function buildFinalResult(
  answer: string,
  filteredMatches: any[],
  chunkToSourceMap: any
): { answer: string, references: Array<Reference> } {
  console.log(`[buildFinalResult] Building final result with ${filteredMatches.length} references`);

  // Build reference objects
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

  // Inject reference markers ([^1], [^2], etc.) into the answer
  let modifiedAnswer = answer;

  // Sort references by position in the answer (to insert markers in correct order)
  const referencesByPosition = [...references]
    .sort((a, b) => a.answerChunkPosition![0] - b.answerChunkPosition![0]);

  console.log(`[buildFinalResult] Injecting reference markers into answer`);

  // Insert markers from beginning to end, tracking offset
  let offset = 0;
  for (let i = 0; i < referencesByPosition.length; i++) {
    const ref = referencesByPosition[i];
    const marker = `[^${i + 1}]`;

    // Calculate position to insert the marker (end of the chunk + current offset)
    let insertPosition = ref.answerChunkPosition![1] + offset;

    // Look ahead to check if there's a list item coming next
    const textAfterInsert = modifiedAnswer.substring(insertPosition);
    const nextListItemMatch = textAfterInsert.match(/^\s*\n\s*\*\s+/);

    // If we're at a position where the next content is a list item,
    // we need to adjust WHERE we place the footnote
    if (nextListItemMatch) {
      // Move the marker to right after the last content character,
      // but INSIDE any punctuation at the end of the content
      const beforeText = modifiedAnswer.substring(Math.max(0, insertPosition - 30), insertPosition);
      const lastPunctuation = beforeText.match(/[！。？!.?]$/);

      if (lastPunctuation) {
        // If there's punctuation at the end, insert the marker before it
        insertPosition--;
      }
    } else {
      // The original conditions for newlines and table pipes can remain
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
    }

    // Insert the marker
    modifiedAnswer =
      modifiedAnswer.slice(0, insertPosition) +
      marker +
      modifiedAnswer.slice(insertPosition);

    // Update offset for subsequent insertions
    offset += marker.length;
  }

  console.log(`[buildFinalResult] Complete. Generated ${references.length} references`);
  return {
    answer: modifiedAnswer,
    references
  };
}

export async function buildImageReferences(
  answer: string,
  imageObjects: ImageObject[],
  context: TrackerContext,
  schema: Schemas,
  minChunkLength: number = 80,
  maxRef: number = 10,
  minRelScore: number = 0.35
): Promise<Array<ImageReference>> {
  console.log(`[buildImageReferences] Starting with maxRef=${maxRef}, minChunkLength=${minChunkLength}, minRelScore=${minRelScore}`);
  console.log(`[buildImageReferences] Answer length: ${answer.length} chars, Image sources: ${imageObjects.length}`);

  // Step 1: Chunk the answer
  console.log(`[buildImageReferences] Step 1: Chunking answer text`);
  const {chunks: answerChunks, chunk_positions: answerChunkPositions} = await segmentText(answer, context);
  console.log(`[buildImageReferences] Answer segmented into ${answerChunks.length} chunks`);

  // Step 2: Prepare image content
  console.log(`[buildImageReferences] Step 2: Preparing image content`);
  const dudupImages = dedupImagesWithEmbeddings(imageObjects, []);
  const allImageEmbeddings: number[][] = dudupImages.map(img => img.embedding[0]); // Extract embedding
  const imageToSourceMap: any = {};
  const validImageIndices = new Set<number>();

  dudupImages.forEach((img, index) => {
      imageToSourceMap[index] = {
          url: img.url,
          altText: img.alt,
          embedding: img.embedding[0] // Store extracted embedding
      };
      validImageIndices.add(index);
  });

  console.log(`[buildImageReferences] Collected ${allImageEmbeddings.length} image embeddings`);

  if (allImageEmbeddings.length === 0) {
      console.log(`[buildImageReferences] No image data available, returning empty array`);
      return [];
  }

  // Step 3: Filter answer chunks by minimum length
  console.log(`[buildImageReferences] Step 3: Filtering answer chunks by minimum length`);
  const validAnswerChunks: string[] = [];
  const validAnswerChunkIndices: number[] = [];
  const validAnswerChunkPositions: [number, number][] = [];

  context.actionTracker.trackThink('cross_reference', schema.languageCode);

  for (let i = 0; i < answerChunks.length; i++) {
      const answerChunk = answerChunks[i];
      const answerChunkPosition = answerChunkPositions[i];

      if (!answerChunk.trim() || answerChunk.length < minChunkLength) continue;

      validAnswerChunks.push(answerChunk);
      validAnswerChunkIndices.push(i);
      validAnswerChunkPositions.push(answerChunkPosition);
  }

  console.log(`[buildImageReferences] Found ${validAnswerChunks.length}/${answerChunks.length} valid answer chunks above minimum length`);

  if (validAnswerChunks.length === 0) {
      console.log(`[buildImageReferences] No valid answer chunks, returning empty array`);
      return [];
  }

  // Step 4: Get embeddings for answer chunks
  console.log(`[buildImageReferences] Step 4: Getting embeddings for answer chunks`);
  const answerEmbeddings: number[][] = [];

  try {
      //  const embeddingsResult = await getEmbeddings(validAnswerChunks, context.tokenTracker, embeddingOptions); //  No embeddingOptions needed here
      //   answerEmbeddings.push(...embeddingsResult.embeddings);
      const embeddingsResult = await getEmbeddings(validAnswerChunks, context.tokenTracker, {
          dimensions: 1024,
          model: 'jina-clip-v2',
      });
      answerEmbeddings.push(...embeddingsResult.embeddings);

      console.log(`[buildImageReferences] Got embeddings for ${answerEmbeddings.length} answer chunks`);

      // Step 5: Compute pairwise cosine similarity
      console.log(`[buildImageReferences] Step 5: Computing pairwise cosine similarity between answer and image embeddings`);
      const allMatches = [];

      for (let i = 0; i < validAnswerChunks.length; i++) {
          const answerChunkIndex = validAnswerChunkIndices[i];
          const answerChunk = validAnswerChunks[i];
          const answerChunkPosition = answerChunkPositions[i];
          const answerEmbedding = answerEmbeddings[i];

          const matchesForChunk = [];

          for (const imageIndex of validImageIndices) {
              const imageEmbedding = allImageEmbeddings[imageIndex];

              if (imageEmbedding) {
                  const score = cosineSimilarity(answerEmbedding, imageEmbedding);

                  matchesForChunk.push({
                      imageIndex,
                      relevanceScore: score
                  });
              }
          }

          matchesForChunk.sort((a, b) => b.relevanceScore - a.relevanceScore);

          for (const match of matchesForChunk) {
              allMatches.push({
                  imageIndex: match.imageIndex,
                  answerChunkIndex: answerChunkIndex,
                  relevanceScore: match.relevanceScore,
                  answerChunk: answerChunk,
                  answerChunkPosition: answerChunkPosition
              });
          }

          console.log(`[buildImageReferences] Processed answer chunk ${i + 1}/${validAnswerChunks.length}, top score: ${matchesForChunk[0]?.relevanceScore.toFixed(4)}`);
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


      // Step 6: Sort all matches by relevance
      allMatches.sort((a, b) => b.relevanceScore - a.relevanceScore);
      console.log(`[buildImageReferences] Step 6: Sorted ${allMatches.length} potential matches by relevance score`);

      // Step 7: Filter matches
      console.log(`[buildImageReferences] Step 7: Filtering matches to ensure uniqueness and threshold (min: ${minRelScore})`);
      const usedImages = new Set();
      const usedAnswerChunks = new Set();
      const filteredMatches = [];

      for (const match of allMatches) {
          if (match.relevanceScore < minRelScore) continue;

          if (!usedImages.has(match.imageIndex) && !usedAnswerChunks.has(match.answerChunkIndex)) {
              filteredMatches.push(match);
              usedImages.add(match.imageIndex);
              usedAnswerChunks.add(match.answerChunkIndex);

              if (filteredMatches.length >= maxRef) break;
          }
      }

      console.log(`[buildImageReferences] Selected ${filteredMatches.length}/${allMatches.length} references after filtering`);

      const references: ImageReference[] = filteredMatches.map((match) => {
          const source = imageToSourceMap[match.imageIndex];
          return {
              url: source.url,
              relevanceScore: match.relevanceScore,
              answerChunk: match.answerChunk,
              answerChunkPosition: match.answerChunkPosition
          };
      });

      return references;

  } catch (error) {
      console.error('Embedding failed', error);
      return [];
  }
}