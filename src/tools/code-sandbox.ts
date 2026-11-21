import { ObjectGeneratorSafe } from "../utils/safe-generator";
import { CodeGenResponse, PromptPair, TrackerContext } from "../types";
import { Schemas } from "../utils/schemas";
import { logInfo, logDebug, logWarning } from '../logging';


interface SandboxResult {
  success: boolean;
  output?: any;
  error?: string;
}


function getPrompt(
  problem: string,
  availableVars: string,
  previousAttempts: Array<{ code: string; error?: string }> = []
): PromptPair {
  const previousAttemptsContext = previousAttempts.map((attempt, index) => `
<bad-attempt-${index + 1}>
${attempt.code}
${attempt.error ? `Error: ${attempt.error}
</bad-attempt-${index + 1}>
` : ''}
`).join('\n');

  const prompt = `You are an expert JavaScript programmer. Your task is to generate JavaScript code to solve the given problem.

<rules>
1. Generate plain JavaScript code that returns the result directly
2. You can access any of these available variables directly:
${availableVars}
3. You don't have access to any third party libraries that need to be installed, so you must write complete, self-contained code.
4. Must have a return statement.
</rules>

${previousAttempts.length > 0 ? `Previous attempts and their errors:
${previousAttemptsContext}
` : ''}

<example>
Available variables:
numbers (Array<number>) e.g. [1, 2, 3, 4, 5, 6]
threshold (number) e.g. 4

Problem: Sum all numbers above threshold

Response:
{
  "code": "return numbers.filter(n => n > threshold).reduce((a, b) => a + b, 0);"
}
</example>`;

  logDebug('Coding prompt', { prompt });

  return { system: prompt, user: problem };
}

export class CodeSandbox {
  private trackers?: TrackerContext;
  private generator: ObjectGeneratorSafe;
  private maxAttempts: number;
  private context: Record<string, any>;
  private schemaGen: Schemas;

  constructor(
    context: any = {},
    trackers: TrackerContext,
    schemaGen: Schemas,
    maxAttempts: number = 3,
  ) {
    this.trackers = trackers;
    this.generator = new ObjectGeneratorSafe(trackers?.tokenTracker);
    this.maxAttempts = maxAttempts;
    this.context = context;
    this.schemaGen = schemaGen;
  }

  private async generateCode(
    problem: string,
    previousAttempts: Array<{ code: string; error?: string }> = []
  ): Promise<CodeGenResponse> {
    const prompt = getPrompt(problem, analyzeStructure(this.context), previousAttempts);

    const result = await this.generator.generateObject({
      model: 'coder',
      schema: this.schemaGen.getCodeGeneratorSchema(),
      system: prompt.system,
      prompt: prompt.user
    });

    this.trackers?.actionTracker.trackThink(result.object.think);

    return result.object as CodeGenResponse;
  }

  private evaluateCode(code: string): SandboxResult {
    try {
      // Create a function that uses 'with' to evaluate in the context and return the result
      const evalInContext = new Function('context', `
        with (context) {
          ${code}
        }
      `);

      logDebug('Context:', { context: this.context });

      // Execute the code with the context and get the return value
      const output = evalInContext(this.context);

      if (output === undefined) {
        return {
          success: false,
          error: 'No value was returned, make sure to use "return" statement to return the result'
        };
      }

      return {
        success: true,
        output
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async solve(problem: string): Promise<{
    solution: { code: string; output: any };
    attempts: Array<{ code: string; error?: string }>;
  }> {
    const attempts: Array<{ code: string; error?: string }> = [];

    for (let i = 0; i < this.maxAttempts; i++) {
      // Generate code
      const generation = await this.generateCode(problem, attempts);
      const { code } = generation;

      // Evaluate the code
      const result = this.evaluateCode(code);

      if (result.success) {
        logInfo('Coding success:', { problem, result });
        return {
          solution: {
            code,
            output: result.output
          },
          attempts
        };
      }

      logWarning('Coding error:', { error: result.error });

      // Store the failed attempt
      attempts.push({
        code,
        error: result.error
      });

      // If we've reached max attempts, throw an error
      if (i === this.maxAttempts - 1) {
        throw new Error(`Failed to generate working code after ${this.maxAttempts} attempts`);
      }
    }

    // This should never be reached due to the throw above
    throw new Error('Unexpected end of execution');
  }
}

function formatValue(value: any): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const type = typeof value;

  if (type === 'string') {
    // Clean and truncate string value
    const cleaned = value.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned.length > 50 ?
      `"${cleaned.slice(0, 47)}..."` :
      `"${cleaned}"`;
  }

  if (type === 'number' || type === 'boolean') {
    return String(value);
  }

  if (value instanceof Date) {
    return `"${value.toISOString()}"`;
  }

  return '';
}

export function analyzeStructure(value: any, indent = ''): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const type = typeof value;

  if (type === 'function') {
    return 'Function';
  }

  // Handle atomic types with example values
  if (type !== 'object' || value instanceof Date) {
    const formattedValue = formatValue(value);
    return `${type}${formattedValue ? ` (example: ${formattedValue})` : ''}`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return 'Array<unknown>';
    const sampleItem = value[0];
    return `Array<${analyzeStructure(sampleItem, indent + '  ')}>`;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';

  const properties = entries
    .map(([key, val]) => {
      const analyzed = analyzeStructure(val, indent + '  ');
      return `${indent}  "${key}": ${analyzed}`;
    })
    .join(',\n');

  return `{\n${properties}\n${indent}}`;
}