import fs from 'fs/promises';
import {exec} from 'child_process';
import {promisify} from 'util';
import {getResponse} from '../agent';
import {generateObject} from 'ai';
import {GEMINI_API_KEY} from '../config';
import {z} from 'zod';
import {AnswerAction, TrackerContext} from "../types";
import {createGoogleGenerativeAI} from "@ai-sdk/google";

const execAsync = promisify(exec);

interface Question {
  question: string;
  answer: string;
}

interface EvaluationResult {
  pass: boolean;
  reason: string;
  total_steps: number;
  total_tokens: number;
  question: string;
  expected_answer: string;
  actual_answer: string;
}

interface EvaluationStats {
  model_name: string;
  pass_rate: number;
  avg_steps: number;
  max_steps: number;
  min_steps: number;
  median_steps: number;
  avg_tokens: number;
  median_tokens: number;
  max_tokens: number;
  min_tokens: number;
}

function calculateMedian(numbers: number[]): number {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function calculateStats(results: EvaluationResult[], modelName: string): EvaluationStats {
  const steps = results.map(r => r.total_steps);
  const tokens = results.map(r => r.total_tokens);
  const passCount = results.filter(r => r.pass).length;

  return {
    model_name: modelName,
    pass_rate: (passCount / results.length) * 100,
    avg_steps: steps.reduce((a, b) => a + b, 0) / steps.length,
    max_steps: Math.max(...steps),
    min_steps: Math.min(...steps),
    median_steps: calculateMedian(steps),
    avg_tokens: tokens.reduce((a, b) => a + b, 0) / tokens.length,
    median_tokens: calculateMedian(tokens),
    max_tokens: Math.max(...tokens),
    min_tokens: Math.min(...tokens)
  };
}

function printStats(stats: EvaluationStats): void {
  console.log('\n=== Evaluation Statistics ===');
  console.log(`Model: ${stats.model_name}`);
  console.log(`Pass Rate: ${stats.pass_rate.toFixed(0)}%`);
  console.log(`Average Steps: ${stats.avg_steps.toFixed(0)}`);
  console.log(`Maximum Steps: ${stats.max_steps}`);
  console.log(`Minimum Steps: ${stats.min_steps}`);
  console.log(`Median Steps: ${stats.median_steps.toFixed(0)}`);
  console.log(`Average Tokens: ${stats.avg_tokens.toFixed(0)}`);
  console.log(`Median Tokens: ${stats.median_tokens.toFixed(0)}`);
  console.log(`Maximum Tokens: ${stats.max_tokens}`);
  console.log(`Minimum Tokens: ${stats.min_tokens}`);
  console.log('===========================\n');
}

async function getCurrentGitCommit(): Promise<string> {
  try {
    const {stdout} = await execAsync('git rev-parse --short HEAD');
    return stdout.trim();
  } catch (error) {
    console.error('Error getting git commit:', error);
    return 'unknown';
  }
}

async function evaluateAnswer(expectedAnswer: string, actualAnswer: string): Promise<{ pass: boolean; reason: string }> {
  const prompt = `You are a deterministic evaluator with zero temperature. Compare the following expected answer with the actual answer and determine if they convey the same information.

Expected answer: ${expectedAnswer}
Actual answer: ${actualAnswer}

Minor wording differences are acceptable as long as the core information of the expected answer is preserved in the actual answer.'`;

  const schema = z.object({
    pass: z.boolean().describe('Whether the actual answer matches the expected answer'),
    reason: z.string().describe('Detailed explanation of why the evaluation passed or failed')
  });

  try {
    const result = await generateObject({
      model: createGoogleGenerativeAI({ apiKey: GEMINI_API_KEY })('gemini-2.0-flash'),  // fix to gemini-2.0-flash for evaluation
      schema,
      prompt,
      maxTokens: 1000,
      temperature: 0  // Setting temperature to 0 for deterministic output
    });

    return result.object;
  } catch (error) {
    console.error('Evaluation failed:', error);
    return {
      pass: false,
      reason: `Evaluation error: ${error}`
    };
  }
}

async function batchEvaluate(inputFile: string): Promise<void> {
  // Read and parse input file
  const questions: Question[] = JSON.parse(await fs.readFile(inputFile, 'utf-8'));
  const results: EvaluationResult[] = [];
  const gitCommit = await getCurrentGitCommit();
  const modelName = process.env.DEFAULT_MODEL_NAME || 'unknown';
  const outputFile = `eval-${gitCommit}-${modelName}.json`;

  // Process each question
  for (let i = 0; i < questions.length; i++) {
    const {question, answer: expectedAnswer} = questions[i];
    console.log(`\nProcessing question ${i + 1}/${questions.length}: ${question}`);

    try {
      // Get response using the agent
      const {
        result: response,
        context
      } = await getResponse(question) as { result: AnswerAction; context: TrackerContext };

      // Get response using the streaming agent
      // const {
      //   result: response,
      //   context
      // } = await getResponseStreamingAgent(question) as { result: AnswerAction; context: TrackerContext };

      const actualAnswer = response.answer;

      // Evaluate the response
      const evaluation = await evaluateAnswer(expectedAnswer, actualAnswer);

      // Record results
      results.push({
        pass: evaluation.pass,
        reason: evaluation.reason,
        total_steps: context.actionTracker.getState().totalStep,
        total_tokens: context.tokenTracker.getTotalUsage(),
        question,
        expected_answer: expectedAnswer,
        actual_answer: actualAnswer
      });

      console.log(`Evaluation: ${evaluation.pass ? 'PASS' : 'FAIL'}`);
      console.log(`Reason: ${evaluation.reason}`);
    } catch (error) {
      console.error(`Error processing question: ${question}`, error);
      results.push({
        pass: false,
        reason: `Error: ${error}`,
        total_steps: 0,
        total_tokens: 0,
        question,
        expected_answer: expectedAnswer,
        actual_answer: 'Error occurred'
      });
    }
  }

  // Calculate and print statistics
  const stats = calculateStats(results, modelName);
  printStats(stats);

  // Save results
  await fs.writeFile(outputFile, JSON.stringify({
    results,
    statistics: stats
  }, null, 2));

  console.log(`\nEvaluation results saved to ${outputFile}`);
}

// Run batch evaluation if this is the main module
if (require.main === module) {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error('Please provide an input file path');
    process.exit(1);
  }

  batchEvaluate(inputFile).catch(console.error);
}

export {batchEvaluate};
