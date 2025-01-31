import {GoogleGenerativeAI, SchemaType} from "@google/generative-ai";
import { GEMINI_API_KEY, MODEL_NAME } from "../config";
import { tokenTracker } from "../utils/token-tracker";

type KeywordsResponse = {
  keywords: string[];
};

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    thought: {
      type: SchemaType.STRING,
      description: "Strategic reasoning about query complexity and search approach"
    },
    keywords: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.STRING,
        description: "Space-separated keywords (2-4 words) optimized for search"
      },
      description: "Array of keyword combinations, each targeting a specific aspect",
      minItems: 1,
      maxItems: 3
    }
  },
  required: ["thought", "keywords"]
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

function getPrompt(query: string): string {
  return `You are an expert Information Retrieval Assistant. Transform user queries into precise keyword combinations, with strategic reasoning.

Core Rules:
1. Always return keywords in array format, even for single queries
2. Keep keywords minimal: 2-4 words preferred
3. Split only when necessary for distinctly different aspects, but a comparison query may need multiple searches for each aspect
4. Remove fluff words (question words, modals, qualifiers)
5. Preserve crucial qualifiers (brands, versions, dates)
6. The generated query should not be easily "captured" by those malicious SEO articles

Examples with Strategic Reasoning:

Input Query: What's the best pizza place in Brooklyn Heights?
Thought: This is a straightforward location-based query. Since it's just about finding pizza places in a specific neighborhood, a single focused search should suffice. No need to complicate it by splitting into multiple searches.
Output Keywords: ["brooklyn heights pizza"]

Input Query: Why does my MacBook M1 Pro battery drain so fast after the latest OS update?
Thought: Hmm, this seems simple at first, but we need multiple angles to properly diagnose. First, we should look for M1 specific battery issues. Then check the OS update problems, as it might be a known issue. By combining results from both searches, we should get a comprehensive answer.
Output Keywords: [
  "macbook m1 battery drain",
  "macos update battery issues"
]

Input Query: How does caffeine timing affect athletic performance and post-workout recovery for morning vs evening workouts?
Thought: This is quite complex - it involves caffeine's effects in different contexts. We need to understand: 1) caffeine's impact on performance, 2) its role in recovery, and 3) timing considerations. All three aspects are crucial for a complete answer. By searching these separately, we can piece together a comprehensive understanding.
Output Keywords: [
  "caffeine athletic performance timing",
  "caffeine post workout recovery",
  "morning evening workout caffeine"
]

Input Query: Need help with my sourdough starter - it's not rising and smells like acetone
Thought: Initially seems like it needs two searches - one for not rising, one for the smell. But wait - these symptoms are likely related and commonly occur together in sourdough troubleshooting. A single focused search should capture solutions for both issues.
Output Keywords: ["sourdough starter troubleshooting"]

Input Query: Looking for a Python machine learning framework that works well with Apple Silicon and can handle large language models
Thought: This query looks straightforward but requires careful consideration. We need information about ML frameworks' compatibility with M1/M2 chips specifically, and then about their LLM capabilities. Two separate searches will give us more precise results than trying to find everything in one search.
Output Keywords: [
  "python ml framework apple silicon",
  "python framework llm support"
]

Now, process this query:
Input Query: ${query}`;
}

export async function rewriteQuery(query: string): Promise<{ keywords: string[], tokens: number }> {
  try {
    const prompt = getPrompt(query);
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const usage = response.usageMetadata;
    const json = JSON.parse(response.text()) as KeywordsResponse;
    console.log('Query rewriter:', json.keywords)
    const tokens = usage?.totalTokenCount || 0;
    tokenTracker.trackUsage('query-rewriter', tokens);
    return { keywords: json.keywords, tokens };
  } catch (error) {
    console.error('Error in query rewriting:', error);
    throw error;
  }
}

// Example usage
async function main() {
  const query = process.argv[2] || "";

  try {
    await rewriteQuery(query);
  } catch (error) {
    console.error('Failed to rewrite query:', error);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
