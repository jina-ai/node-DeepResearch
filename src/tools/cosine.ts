import { logWarning } from '../logging';

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magnitudeA += vecA[i] * vecA[i];
    magnitudeB += vecB[i] * vecB[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  return (magnitudeA > 0 && magnitudeB > 0) ? dotProduct / (magnitudeA * magnitudeB) : 0;
}

// Fallback similarity ranking using Jaccard
export async function jaccardRank(query: string, documents: string[]): Promise<{ results: { index: number, relevance_score: number }[] }> {
  logWarning(`[fallback] Using Jaccard similarity for ${documents.length} documents`);
  // Convert texts to lowercase and tokenize by splitting on non-alphanumeric characters
  const queryTokens = new Set(query.toLowerCase().split(/\W+/).filter(t => t.length > 0));

  const results = documents.map((doc, index) => {
    const docTokens = new Set(doc.toLowerCase().split(/\W+/).filter(t => t.length > 0));

    // Calculate intersection size
    const intersection = new Set([...queryTokens].filter(x => docTokens.has(x)));

    // Calculate union size
    const union = new Set([...queryTokens, ...docTokens]);

    // Calculate Jaccard similarity
    const score = union.size === 0 ? 0 : intersection.size / union.size;

    return { index, relevance_score: score };
  });

  // Sort by score in descending order
  results.sort((a, b) => b.relevance_score - a.relevance_score);

  return { results };
}
