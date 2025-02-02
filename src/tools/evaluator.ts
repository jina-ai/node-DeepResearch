import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { GEMINI_API_KEY, MODEL_NAME } from "../config";
import { tokenTracker } from "../utils/token-tracker";

import { EvaluationResponse } from '../types';

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    is_definitive: {
      type: SchemaType.BOOLEAN,
      description: "Whether the answer provides a definitive response without uncertainty or 'I don't know' type statements"
    },
    reasoning: {
      type: SchemaType.STRING,
      description: "Explanation of why the answer is or isn't definitive"
    }
  },
  required: ["is_definitive", "reasoning"]
};

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: MODEL_NAME,
  generationConfig: {
    temperature: 0,
    responseMimeType: "application/json",
    responseSchema: responseSchema
  }
});

function getPrompt(question: string, answer: string): string {
  return `You are an evaluator of answer definitiveness. Analyze if the given answer provides a definitive response or not.

Core Evaluation Criterion:
- Definitiveness: "I don't know", "lack of information", "doesn't exist", "not sure" or highly uncertain/ambiguous responses are **not** definitive, must return false!

Examples:

Question: "What are the system requirements for running Python 3.9?"
Answer: "I'm not entirely sure, but I think you need a computer with some RAM."
Evaluation: {
  "is_definitive": false,
  "reasoning": "The answer contains uncertainty markers like 'not entirely sure' and 'I think', making it non-definitive."
}

Question: "What are the system requirements for running Python 3.9?"
Answer: "Python 3.9 requires Windows 7 or later, macOS 10.11 or later, or Linux."
Evaluation: {
  "is_definitive": true,
  "reasoning": "The answer makes clear, definitive statements without uncertainty markers or ambiguity."
}

Question: "what is the twitter account of jina ai's founder?"
Answer: "The provided text does not contain the Twitter account of Jina AI's founder."
Evaluation: {
  "is_definitive": false,
  "reasoning": "The answer indicates a lack of information rather than providing a definitive response."
}

Now evaluate this pair:
Question: ${JSON.stringify(question)}
Answer: ${JSON.stringify(answer)}`;
}

export async function evaluateAnswer(question: string, answer: string): Promise<{ response: EvaluationResponse, tokens: number }> {
  try {
    const prompt = getPrompt(question, answer);
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const usage = response.usageMetadata;
    const json = JSON.parse(response.text()) as EvaluationResponse;
    console.log('Evaluation:', {
      definitive: json.is_definitive,
      reason: json.reasoning
    });
    const tokens = usage?.totalTokenCount || 0;
    tokenTracker.trackUsage('evaluator', tokens);
    return { response: json, tokens };
  } catch (error) {
    console.error('Error in answer evaluation:', error);
    throw error;
  }
}

// Example usage
async function main() {
  const question = process.argv[2] || '';
  const answer = process.argv[3] || '';

  if (!question || !answer) {
    console.error('Please provide both question and answer as command line arguments');
    process.exit(1);
  }

  try {
    await evaluateAnswer(question, answer);
  } catch (error) {
    console.error('Failed to evaluate answer:', error);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
