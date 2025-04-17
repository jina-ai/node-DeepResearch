import {TrackerContext} from "../types";
import {Schemas} from "../utils/schemas";
import {cosineSimilarity} from "./cosine";
import {getEmbeddings} from "./embeddings";

// Refactored cherryPick function
export async function cherryPick(question: string, longContext: string, options: any = {}, trackers: TrackerContext, schemaGen: Schemas, url: string) {
  const {
    snippetLength = 6000,  // char length of each snippet
    numSnippets = Math.max(2, Math.min(5, Math.floor(longContext.length / snippetLength))),
    chunkSize = 300,  // char length of each chunk
  } = options;

  if (longContext.length < snippetLength * 2) {
    // If the context is shorter than the snippet length, return the whole context
    console.log('content is too short, dont bother');
    return longContext;
  }

  // Split the longContext into chunks of chunkSize
  const chunks: string[] = [];
  for (let i = 0; i < longContext.length; i += chunkSize) {
    chunks.push(longContext.substring(i, Math.min(i + chunkSize, longContext.length)));
  }

  console.log('late chunking enabled! num chunks:', chunks.length);

  trackers.actionTracker.trackThink('late_chunk', schemaGen.languageCode, {url});

  try {
    if (question.trim().length === 0) {
      throw new Error('Empty question, returning full context');
    }

    // Get embeddings for all chunks using the new getEmbeddings function
    const chunkEmbeddingResult = await getEmbeddings(
      chunks,
      trackers.tokenTracker,
      {
        task: "retrieval.passage",
        dimensions: 1024,
        late_chunking: true,
        embedding_type: "float"
      }
    );

    const allChunkEmbeddings = chunkEmbeddingResult.embeddings;

    // Get embedding for the question
    const questionEmbeddingResult = await getEmbeddings(
      [question],
      trackers.tokenTracker,
      {
        task: "retrieval.query",
        dimensions: 1024,
        embedding_type: "float"
      }
    );

    const questionEmbedding = questionEmbeddingResult.embeddings[0];

    // Verify that we got embeddings for all chunks
    if (allChunkEmbeddings.length !== chunks.length) {
      console.error(`Got ${allChunkEmbeddings.length} embeddings for ${chunks.length} chunks`);
    }

    // Calculate cosine similarity between the question and each chunk
    const similarities = allChunkEmbeddings.map((chunkEmbed: number[]) => {
      return cosineSimilarity(questionEmbedding, chunkEmbed);
    });

    // Calculate the number of chunks needed for a single snippet
    const chunksPerSnippet = Math.ceil(snippetLength / chunkSize);

    // Find the top `numSnippets` snippets with highest average similarity
    const snippets: string[] = [];

    // Create a copy of similarities to avoid modifying the original
    const similaritiesCopy = [...similarities];

    for (let i = 0; i < numSnippets; i++) {
      // Find the best starting position for the snippet
      let bestStartIndex = 0;
      let bestScore = -Infinity;

      // Check each possible starting position for a snippet
      for (let j = 0; j <= similarities.length - chunksPerSnippet; j++) {
        // Calculate the average similarity for the current window
        const windowScores = similaritiesCopy.slice(j, j + chunksPerSnippet);
        const windowScore = windowScores.reduce((sum, score) => sum + score, 0) / windowScores.length;

        if (windowScore > bestScore) {
          bestScore = windowScore;
          bestStartIndex = j;
        }
      }

      // Extract the snippet text
      const startIndex = bestStartIndex * chunkSize;
      const endIndex = Math.min(startIndex + snippetLength, longContext.length);
      snippets.push(longContext.substring(startIndex, endIndex));

      // Mark the used chunks with a very low score to avoid reusing them
      for (let k = bestStartIndex; k < bestStartIndex + chunksPerSnippet && k < similaritiesCopy.length; k++) {
        similaritiesCopy[k] = -Infinity;
      }
    }

    // wrap with <snippet-index> tag
    return snippets.map((snippet, index) => `
<snippet-${index + 1}>

${snippet}

</snippet-${index + 1}>`.trim()).join("\n\n");

  } catch (error) {
    console.error('Error in late chunking:', error);
    // Fallback: just return the beginning of the context up to the desired length
    return longContext.substring(0, snippetLength * numSnippets);
  }
}