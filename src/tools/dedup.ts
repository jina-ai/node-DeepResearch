import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { GEMINI_API_KEY, MODEL_NAME } from "../config";
import { tokenTracker } from "../utils/token-tracker";

type DedupResponse = {
  thought: string;
  unique_queries: string[];
};

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    thought: {
      type: SchemaType.STRING,
      description: "Strategic reasoning about the overall deduplication approach"
    },
    unique_queries: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.STRING
      },
      description: "Array of semantically unique queries from set A"
    }
  },
  required: ["thought", "unique_queries"]
};

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: MODEL_NAME,
  generationConfig: {
    temperature: 0.1,
    responseMimeType: "application/json",
    responseSchema: responseSchema
  }
});

function getPrompt(newQueries: string[], existingQueries: string[]): string {
  return `You are an expert in semantic similarity analysis. Given a set of new queries (A) and existing queries (B), identify which queries from set A are semantically unique when compared BOTH to other queries within A AND to queries in set B.

Core Rules:
1. Consider semantic meaning and query intent, not just lexical similarity
2. Account for different phrasings of the same information need
3. A query is considered duplicate if its core information need is already covered by:
   - any query in set A
   - OR any query in set B
4. Be aggressive - mark as duplicate as long as they are reasonably similar
5. Different aspects or perspectives of the same object are not duplicates
6. Consider query specificity - a more specific query might not be a duplicate of a general one

Examples:

Set A: [
  "how to install python on windows",
  "what's the best pizza in brooklyn heights",
  "windows python installation guide",
  "recommend good pizza places brooklyn heights"
]
Set B: [
  "macbook setup guide",
  "restaurant recommendations manhattan"
]
Thought: Let's analyze set A both internally and against B:
1. The first python installation query is unique
2. The first pizza query is unique
3. The second python query is a duplicate of the first
4. The second pizza query is a duplicate of the earlier one
Neither query in set B is similar enough to affect our decisions.
Unique Queries: [
  "how to install python on windows",
  "what's the best pizza in brooklyn heights"
]

Now, analyze these sets:
Set A: ${JSON.stringify(newQueries)}
Set B: ${JSON.stringify(existingQueries)}`;
}

export async function dedupQueries(newQueries: string[], existingQueries: string[]): Promise<{ unique_queries: string[], tokens: number }> {
  try {
    const prompt = getPrompt(newQueries, existingQueries);
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const usage = response.usageMetadata;
    const json = JSON.parse(response.text()) as DedupResponse;
    console.log('Dedup:', json.unique_queries);
    const tokens = usage?.totalTokenCount || 0;
    tokenTracker.trackUsage('dedup', tokens);
    return { unique_queries: json.unique_queries, tokens };
  } catch (error) {
    console.error('Error in deduplication analysis:', error);
    throw error;
  }
}

// Example usage
async function main() {
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
