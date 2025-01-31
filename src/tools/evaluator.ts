import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { GEMINI_API_KEY, MODEL_NAME } from "../config";
import { tokenTracker } from "../utils/token-tracker";

type EvaluationResponse = {
  is_valid_answer: boolean;
  reasoning: string;
};

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    is_valid_answer: {
      type: SchemaType.BOOLEAN,
      description: "Whether the answer provides any useful information to the question"
    },
    reasoning: {
      type: SchemaType.STRING,
      description: "Detailed explanation of the evaluation"
    }
  },
  required: ["is_valid_answer", "reasoning"]
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
  return `You are an expert evaluator of question-answer pairs. Analyze if the given answer based on the following criteria is valid or not.

Core Evaluation Criteria:
- Definitiveness: "I don't know", "lack of information", "doesn't exist" or highly uncertain ambiguous responses are **not** valid answers, must return false!
- Informativeness: Answer must provide substantial, useful information

Examples:

Question: "What are the system requirements for running Python 3.9?"
Answer: "I'm not entirely sure, but I think you need a computer with some RAM."
Evaluation: {
  "is_valid_answer": false,
  "reasoning": "The answer is vague, uncertain, and lacks specific information about actual system requirements. It fails the specificity and informativeness criteria."
}

Question: "What are the system requirements for running Python 3.9?"
Answer: "Python 3.9 requires: Windows 7 or later, macOS 10.11 or later, or Linux. Minimum 4GB RAM recommended, 2GB disk space, and x86-64 processor. For Windows, you'll need Microsoft Visual C++ 2015 or later."
Evaluation: {
  "is_valid_answer": true,
  "reasoning": "The answer is comprehensive, specific, and covers all key system requirements across different operating systems. It provides concrete numbers and necessary additional components."
}

Question: "what is the twitter account of jina ai's founder?"
Answer: "The provided text does not contain the Twitter account of Jina AI's founder."
Evaluation: {
  "is_valid_answer": false,
  "reasoning": "The answer is not definitive and fails to provide the requested information. Don't know, can't derive, lack of information is unacceptable,"
}

Question: "who owns jina ai?"
Answer: "The ownership structure of Jina AI is not publicly disclosed."
Evaluation: {
  "is_valid_answer": false,
  "reasoning": "The answer is not definitive and fails to provide the requested information. Lack of information is unacceptable, more search and deep reasoning is needed."
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
    console.debug('\x1b[36m%s\x1b[0m', 'Evaluation intermediate result:', json);
    console.info('\x1b[32m%s\x1b[0m', 'Evaluation final output:', {
      valid: json.is_valid_answer,
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

  console.log('\nQuestion:', question);
  console.log('Answer:', answer);

  try {
    const evaluation = await evaluateAnswer(question, answer);
    console.log('\nEvaluation Result:', evaluation);
  } catch (error) {
    console.error('Failed to evaluate answer:', error);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
