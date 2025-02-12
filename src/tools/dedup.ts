import {z} from 'zod';
import {TokenTracker} from "../utils/token-tracker";
import {ObjectGeneratorSafe} from "../utils/safe-generator";


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


const TOOL_NAME = 'dedup';

export async function dedupQueries(
  newQueries: string[],
  existingQueries: string[],
  tracker?: TokenTracker
): Promise<{ unique_queries: string[] }> {
  try {
    const generator = new ObjectGeneratorSafe(tracker);
    const prompt = getPrompt(newQueries, existingQueries);

    const result = await generator.generateObject({
      model: TOOL_NAME,
      schema: responseSchema,
      prompt,
    });

    console.log(TOOL_NAME, result.object.unique_queries);
    return {unique_queries: result.object.unique_queries};

  } catch (error) {
    console.error(`Error in ${TOOL_NAME}`, error);
    throw error;
  }
}