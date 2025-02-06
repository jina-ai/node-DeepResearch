import { z } from 'zod';
import { generateObject } from 'ai';
import { getModel, getMaxTokens } from "../config";
import { TokenTracker } from "../utils/token-tracker";
import { handleGenerateObjectError } from '../utils/error-handling';
import type { DedupResponse } from '../types';

const model = getModel('dedup');

const responseSchema = z.object({
  think: z.string().describe('Strategic reasoning about the overall deduplication approach'),
  unique_queries: z.array(z.string().describe('Unique query that passed the deduplication process, must be less than 30 characters'))
    .describe('Array of semantically unique queries').max(3)
});

function getPrompt(newQueries: string[], existingQueries: string[]): string {
  return `You are an expert in semantic similarity analysis. Given a set of queries (setA) and a set of queries (setB)

<rules>
Function FilterSetA(setA, setB, threshold):
    filteredA = empty set
    
    for each candidateQuery in setA:
        isValid = true
        
        // Check similarity with already accepted queries in filteredA
        for each acceptedQuery in filteredA:
            similarity = calculateSimilarity(candidateQuery, acceptedQuery)
            if similarity >= threshold:
                isValid = false
                break
        
        // If passed first check, compare with set B
        if isValid:
            for each queryB in setB:
                similarity = calculateSimilarity(candidateQuery, queryB)
                if similarity >= threshold:
                    isValid = false
                    break
        
        // If passed all checks, add to filtered set
        if isValid:
            add candidateQuery to filteredA
    
    return filteredA
</rules>    

<similarity-definition>
1. Consider semantic meaning and query intent, not just lexical similarity
2. Account for different phrasings of the same information need
3. Queries with same base keywords but different operators are NOT duplicates
4. Different aspects or perspectives of the same topic are not duplicates
5. Consider query specificity - a more specific query is not a duplicate of a general one
6. Search operators that make queries behave differently:
   - Different site: filters (e.g., site:youtube.com vs site:github.com)
   - Different file types (e.g., filetype:pdf vs filetype:doc)
   - Different language/location filters (e.g., lang:en vs lang:es)
   - Different exact match phrases (e.g., "exact phrase" vs no quotes)
   - Different inclusion/exclusion (+/- operators)
   - Different title/body filters (intitle: vs inbody:)
</similarity-definition>

Now with threshold set to 0.2; run FilterSetA on the following:
SetA: ${JSON.stringify(newQueries)}
SetB: ${JSON.stringify(existingQueries)}`;
}

export async function dedupQueries(newQueries: string[], existingQueries: string[], tracker?: TokenTracker): Promise<{ unique_queries: string[], tokens: number }> {
  try {
    const prompt = getPrompt(newQueries, existingQueries);
    let object;
    let tokens = 0;
    try {
      const result = await generateObject({
        model,
        schema: responseSchema,
        prompt,
        maxTokens: getMaxTokens('dedup')
      });
      object = result.object;
      tokens = result.usage?.totalTokens || 0;
    } catch (error) {
      const result = await handleGenerateObjectError<DedupResponse>(error);
      object = result.object;
      tokens = result.totalTokens;
    }
    console.log('Dedup:', object.unique_queries);
    (tracker || new TokenTracker()).trackUsage('dedup', tokens);
    return { unique_queries: object.unique_queries, tokens };
  } catch (error) {
    console.error('Error in deduplication analysis:', error);
    throw error;
  }
}

export async function main() {
  const newQueries = process.argv[2] ? JSON.parse(process.argv[2]) : [];
  const existingQueries = process.argv[3] ? JSON.parse(process.argv[3]) : [];

  try {
    await dedupQueries(newQueries, existingQueries);
  } catch (error) {
    console.error('Failed to deduplicate queries:', error);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
