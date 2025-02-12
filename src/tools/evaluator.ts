import {z} from 'zod';
import {GenerateObjectResult} from 'ai';
import {TokenTracker} from "../utils/token-tracker";
import {AnswerAction, EvaluationResponse} from '../types';
import {readUrl, removeAllLineBreaks} from "./read";
import {ObjectGeneratorSafe} from "../utils/safe-generator";


type EvaluationType = 'definitive' | 'freshness' | 'plurality' | 'attribution';

const baseSchema = {
  pass: z.boolean().describe('Whether the answer passes the evaluation criteria defined by the evaluator'),
  think: z.string().describe('Explanation the thought process why the answer does not pass the evaluation criteria')
};

const definitiveSchema = z.object({
  ...baseSchema,
  type: z.literal('definitive')
});

const freshnessSchema = z.object({
  ...baseSchema,
  type: z.literal('freshness'),
  freshness_analysis: z.object({
    likely_outdated: z.boolean().describe('Whether the answer content is likely outdated based on dates and current time'),
    dates_mentioned: z.array(z.string()).describe('All dates mentioned in the answer'),
    current_time: z.string().describe('Current system time when evaluation was performed'),
    max_age_days: z.number().optional().describe('Maximum allowed age in days before content is considered outdated')
  })
});

const pluralitySchema = z.object({
  ...baseSchema,
  type: z.literal('plurality'),
  plurality_analysis: z.object({
    expects_multiple: z.boolean().describe('Whether the question asks for multiple items'),
    provides_multiple: z.boolean().describe('Whether the answer provides multiple items'),
    count_expected: z.number().optional().describe('Number of items expected if specified in question'),
    count_provided: z.number().describe('Number of items provided in answer')
  })
});

const attributionSchema = z.object({
  ...baseSchema,
  type: z.literal('attribution'),
  attribution_analysis: z.object({
    sources_provided: z.boolean().describe('Whether the answer provides source references'),
    sources_verified: z.boolean().describe('Whether the provided sources contain the claimed information'),
    quotes_accurate: z.boolean().describe('Whether the quotes accurately represent the source content')
  })
});

function getAttributionPrompt(question: string, answer: string, sourceContent: string): string {
  return `You are an evaluator that verifies if answer content is properly attributed to and supported by the provided sources.

<rules>
1. Source Verification:
   - Check if answer claims are supported by the provided source content
   - Verify that quotes are accurate and in proper context
   - Ensure numerical data and statistics match the source
   - Flag any claims that go beyond what the sources support

2. Attribution Analysis:
   - Check if answer properly references its sources
   - Verify that important claims have clear source attribution
   - Ensure quotes are properly marked and cited
   - Check for any unsupported generalizations

3. Accuracy Requirements:
   - Direct quotes must match source exactly
   - Paraphrasing must maintain original meaning
   - Statistics and numbers must be precise
   - Context must be preserved
</rules>

<examples>
Question: "What are Jina AI's main products?"
Answer: "According to Jina AI's website, their main products are DocArray and Jina Framework."
Source Content: "Jina AI's flagship products include DocArray, Jina Framework, and JCloud, offering a complete ecosystem for neural search applications."
Evaluation: {
  "pass": false,
  "think": "The answer omits JCloud which is mentioned as a main product in the source. The information provided is incomplete and potentially misleading as it fails to mention a significant product from the company's ecosystem.",
  "attribution_analysis": {
    "sources_provided": true,
    "sources_verified": false,
    "quotes_accurate": false
  }
}

Question: "When was Python first released?"
Answer: "Python was first released in 1991 by Guido van Rossum."
Source Content: "Python was first released in 1991 by Guido van Rossum while working at CWI."
Evaluation: {
  "pass": true,
  "think": "The answer accurately reflects the core information from the source about Python's release date and creator, though it omits the additional context about CWI which isn't essential to the question.",
  "attribution_analysis": {
    "sources_provided": true,
    "sources_verified": true,
    "quotes_accurate": true
  }
}
</examples>

Now evaluate this pair:
Question: ${JSON.stringify(question)}
Answer: ${JSON.stringify(answer)}
Source Content: ${JSON.stringify(sourceContent)}`;
}

function getDefinitivePrompt(question: string, answer: string): string {
  return `You are an evaluator of answer definitiveness. Analyze if the given answer provides a definitive response or not.

<rules>
First, if the answer is not a direct response to the question, it must return false. 
Definitiveness is the king! The following types of responses are NOT definitive and must return false:
  1. Expressions of uncertainty: "I don't know", "not sure", "might be", "probably"
  2. Lack of information statements: "doesn't exist", "lack of information", "could not find"
  3. Inability statements: "I cannot provide", "I am unable to", "we cannot"
  4. Negative statements that redirect: "However, you can...", "Instead, try..."
  5. Non-answers that suggest alternatives
</rules>

<examples>
Question: "What are the system requirements for running Python 3.9?"
Answer: "I'm not entirely sure, but I think you need a computer with some RAM."
Evaluation: {
  "pass": false,
  "think": "The answer contains uncertainty markers like 'not entirely sure' and 'I think', making it non-definitive."
}

Question: "What are the system requirements for running Python 3.9?"
Answer: "Python 3.9 requires Windows 7 or later, macOS 10.11 or later, or Linux."
Evaluation: {
  "pass": true,
  "think": "The answer makes clear, definitive statements without uncertainty markers or ambiguity."
}

Question: "Who will be the president of the United States in 2032?"
Answer: "I cannot predict the future, it depends on the election results."
Evaluation: {
  "pass": false,
  "think": "The answer contains a statement of inability to predict the future, making it non-definitive."
}

Question: "Who is the sales director at Company X?"
Answer: "I cannot provide the name of the sales director, but you can contact their sales team at sales@companyx.com"
Evaluation: {
  "pass": false,
  "think": "The answer starts with 'I cannot provide' and redirects to an alternative contact method instead of answering the original question."
}

Question: "what is the twitter account of jina ai's founder?"
Answer: "The provided text does not contain the Twitter account of Jina AI's founder."
Evaluation: {
  "pass": false,
  "think": "The answer indicates a lack of information rather than providing a definitive response."
}
</examples>

Now evaluate this pair:
Question: ${JSON.stringify(question)}
Answer: ${JSON.stringify(answer)}`;
}

function getFreshnessPrompt(question: string, answer: string, currentTime: string): string {
  return `You are an evaluator that analyzes if answer content is likely outdated based on mentioned dates and current time.

<rules>
1. Date Analysis:
   - Extract all dates mentioned in the answer
   - Compare against current system time: ${currentTime}
   - Consider content outdated if:
     * It refers to a "latest" or "current" state from more than 30 days ago
     * It mentions specific dates/events that have been superseded
     * It contains time-sensitive information (e.g., "current CEO", "latest version") from more than 60 days ago
   - For product versions, releases, or announcements, max age is 30 days
   - For company positions, leadership, or general facts, max age is 60 days

2. Context Hints:
   - Words indicating recency: "latest", "current", "newest", "just released", "recently"
   - Time-sensitive terms: "CEO", "price", "version", "release"
   - Future dates should be ignored in outdated calculation
</rules>

<examples>
Question: "What is Jina AI's latest embedding model?"
Answer: "The latest embedding model from Jina AI is jina-embeddings-v2, released on March 15, 2024."
Current Time: "2024-10-06T00:00:00Z"
Evaluation: {
  "pass": false,
  "think": "The answer refers to a 'latest' model release from over 6 months ago, which is likely outdated for product version information",
  "freshness_analysis": {
    "likely_outdated": true,
    "dates_mentioned": ["2024-03-15"],
    "current_time": "2024-10-06T00:00:00Z",
    "max_age_days": 30
  }
}

Question: "Who is OpenAI's CEO?"
Answer: "Sam Altman is the CEO of OpenAI as of December 2023."
Current Time: "2024-02-06T00:00:00Z"
Evaluation: {
  "pass": true,
  "think": "The answer is about company leadership and is within the 60-day threshold for such information",
  "freshness_analysis": {
    "likely_outdated": false,
    "dates_mentioned": ["2023-12"],
    "current_time": "2024-02-06T00:00:00Z",
    "max_age_days": 60
  }
}
</examples>

Now evaluate this pair:
Question: ${JSON.stringify(question)}
Answer: ${JSON.stringify(answer)}`;
}

function getPluralityPrompt(question: string, answer: string): string {
  return `You are an evaluator that analyzes if answers provide the appropriate number of items requested in the question.

<rules>
1. Question Analysis:
   - Check if question asks for multiple items using indicators like:
     * Plural nouns: "companies", "people", "names"
     * Quantifiers: "all", "many", "several", "various", "multiple"
     * List requests: "list", "enumerate", "name all", "give me all"
     * Numbers: "5 examples", "top 10"
   - Otherwise skip the analysis and return pass to true

2. Answer Analysis:
   - Count distinct items provided in the answer
   - Check if answer uses limiting words like "only", "just", "single"
   - Identify if answer acknowledges there are more items but only provides some

3. Definitiveness Rules:
   - If question asks for multiple items but answer provides only one → NOT definitive
   - If question asks for specific number (e.g., "top 5") but answer provides fewer → NOT definitive
   - If answer clearly states it's providing a partial list → NOT definitive
   - If question asks for "all" or "every" but answer seems incomplete → NOT definitive
</rules>

<examples>
Question: "Who works in Jina AI's sales team?"
Answer: "John Smith is a sales representative at Jina AI."
Evaluation: {
  "pass": true,
  "think": "The question doesn't specifically ask for multiple team members, so a single name can be considered a definitive answer.",
  "plurality_analysis": {
    "expects_multiple": false,
    "provides_multiple": false,
    "count_provided": 1
  }
}

Question: "List all the salespeople who work at Jina AI"
Answer: "John Smith is a sales representative at Jina AI."
Evaluation: {
  "pass": false,
  "think": "The question asks for 'all salespeople' but the answer only provides one name without indicating if this is the complete list.",
  "plurality_analysis": {
    "expects_multiple": true,
    "provides_multiple": false,
    "count_provided": 1
  }
}

Question: "Name the top 3 products sold by Jina AI"
Answer: "Jina AI's product lineup includes DocArray and Jina."
Evaluation: {
  "pass": false,
  "think": "The question asks for top 3 products but only 2 are provided.",
  "plurality_analysis": {
    "expects_multiple": true,
    "provides_multiple": true,
    "count_expected": 3,
    "count_provided": 2
  }
}

Question: "List as many AI companies in Berlin as you can find"
Answer: "Here are several AI companies in Berlin: Ada Health, Merantix, DeepL, Understand.ai, and Zeitgold. There are many more AI companies in Berlin, but these are some notable examples."
Evaluation: {
  "pass": false,
  "think": "While the answer provides multiple companies, it explicitly states it's an incomplete list when the question asks to list as many as possible.",
  "plurality_analysis": {
    "expects_multiple": true,
    "provides_multiple": true,
    "count_provided": 5
  }
}
</examples>

Now evaluate this pair:
Question: ${JSON.stringify(question)}
Answer: ${JSON.stringify(answer)}`;
}


const questionEvaluationSchema = z.object({
  needsFreshness: z.boolean().describe('Whether the question requires freshness check'),
  needsPlurality: z.boolean().describe('Whether the question requires plurality check'),
  reasoning: z.string().describe('Explanation of why these checks are needed or not needed')
});

function getQuestionEvaluationPrompt(question: string): string {
  return `You are an evaluator that determines if a question requires freshness and/or plurality checks in addition to the required definitiveness check.

<evaluation_types>
1. freshness - Checks if the question is time-sensitive or requires very recent information
2. plurality - Checks if the question asks for multiple items or a specific count or enumeration
</evaluation_types>

<rules>
If question is a simple greeting, chit-chat, or general knowledge, provide the answer directly.

1. Freshness Evaluation:
   - Required for questions about current state, recent events, or time-sensitive information
   - Required for: prices, versions, leadership positions, status updates
   - Look for terms: "current", "latest", "recent", "now", "today", "new"
   - Consider company positions, product versions, market data time-sensitive

2. Plurality Evaluation:
   - Required when question asks for multiple items or specific counts
   - Check for: numbers ("5 examples"), plural nouns, list requests
   - Look for: "all", "list", "enumerate", "examples", plural forms
   - Required when question implies completeness ("all the reasons", "every factor")
</rules>

<examples>
Question: "Hello, how are you?"
Evaluation: {
  "needsFreshness": false,
  "needsPlurality": false,
  "reasoning": "Simple greeting, no additional checks needed."
}

Question: "What is the current CEO of OpenAI?"
Evaluation: {
  "needsFreshness": true,
  "needsPlurality": false,
  "reasoning": "Question asks about current leadership position which requires freshness check. No plurality check needed as it asks for a single position."
}

Question: "List all the AI companies in Berlin"
Evaluation: {
  "needsFreshness": false,
  "needsPlurality": true,
  "reasoning": "Question asks for a comprehensive list ('all') which requires plurality check. No freshness check needed as it's not time-sensitive."
}

Question: "What are the top 5 latest AI models released by OpenAI?"
Evaluation: {
  "needsFreshness": true,
  "needsPlurality": true,
  "reasoning": "Question requires freshness check for 'latest' releases and plurality check for 'top 5' items."
}

Question: "Who created Python?"
Evaluation: {
  "needsFreshness": false,
  "needsPlurality": false,
  "reasoning": "Simple factual question requiring only definitiveness check. No time sensitivity or multiple items needed."
}
</examples>

Now evaluate this question:
Question: ${JSON.stringify(question)}`;
}

const TOOL_NAME = 'evaluator';

export async function evaluateQuestion(
  question: string,
  tracker?: TokenTracker
): Promise<EvaluationType[]> {
  try {
    const generator = new ObjectGeneratorSafe(tracker);

    const result = await generator.generateObject({
      model: TOOL_NAME,
      schema: questionEvaluationSchema,
      prompt: getQuestionEvaluationPrompt(question),
    });

    console.log('Question Evaluation:', result.object);

    // Always include definitive in types
    const types: EvaluationType[] = ['definitive'];
    if (result.object.needsFreshness) types.push('freshness');
    if (result.object.needsPlurality) types.push('plurality');

    console.log('Question Metrics:', types);

    // Always evaluate definitive first, then freshness (if needed), then plurality (if needed)
    return types;

  } catch (error) {
    console.error('Error in question evaluation:', error);
    // Default to all evaluation types in case of error
    return ['definitive', 'freshness', 'plurality'];
  }
}


async function performEvaluation<T>(
  evaluationType: EvaluationType,
  params: {
    schema: z.ZodType<T>;
    prompt: string;
  },
  tracker?: TokenTracker
): Promise<GenerateObjectResult<T>> {
  const generator = new ObjectGeneratorSafe(tracker);

  const result = await generator.generateObject({
    model: TOOL_NAME,
    schema: params.schema,
    prompt: params.prompt,
  });

  console.log(`${evaluationType} ${TOOL_NAME}`, result.object);

  return result as GenerateObjectResult<any>;
}


// Main evaluation function
export async function evaluateAnswer(
  question: string,
  action: AnswerAction,
  evaluationOrder: EvaluationType[] = ['definitive', 'freshness', 'plurality'],
  tracker?: TokenTracker
): Promise<{ response: EvaluationResponse }> {
  let result;

  // Only add attribution if we have valid references
  if (action.references && action.references.length > 0) {
    evaluationOrder = ['attribution', ...evaluationOrder];
  }

  for (const evaluationType of evaluationOrder) {
    switch (evaluationType) {
      case 'attribution': {
        // Safely handle references and ensure we have content
        const urls = action.references?.map(ref => ref.url) ?? [];
        const uniqueURLs = [...new Set(urls)];
        const allKnowledge = await fetchSourceContent(uniqueURLs, tracker);

        if (!allKnowledge.trim()) {
          return {
            response: {
              pass: false,
              think: "The answer does not provide any valid attribution references that could be verified. No accessible source content was found to validate the claims made in the answer.",
              type: 'attribution',
            }
          };
        }

        result = await performEvaluation(
          'attribution',
          {
            schema: attributionSchema,
            prompt: getAttributionPrompt(question, action.answer, allKnowledge),
          },
          tracker
        );
        break;
      }

      case 'definitive':
        result = await performEvaluation(
          'definitive',
          {
            schema: definitiveSchema,
            prompt: getDefinitivePrompt(question, action.answer),
          },
          tracker
        );
        break;

      case 'freshness':
        result = await performEvaluation(
          'freshness',
          {
            schema: freshnessSchema,
            prompt: getFreshnessPrompt(question, action.answer, new Date().toISOString()),
          },
          tracker
        );
        break;

      case 'plurality':
        result = await performEvaluation(
          'plurality',
          {
            schema: pluralitySchema,
            prompt: getPluralityPrompt(question, action.answer),
          },
          tracker
        );
        break;
    }

    if (!result?.object.pass) {
      return {response: result.object};
    }
  }

  return {response: result!.object};
}

// Helper function to fetch and combine source content
async function fetchSourceContent(urls: string[], tracker?: TokenTracker): Promise<string> {
  if (!urls.length) return '';

  try {
    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          const {response} = await readUrl(url, tracker);
          const content = response?.data?.content || '';
          return removeAllLineBreaks(content);
        } catch (error) {
          console.error('Error reading URL:', error);
          return '';
        }
      })
    );

    // Filter out empty results and join with proper separation
    return results
      .filter(content => content.trim())
      .join('\n\n');
  } catch (error) {
    console.error('Error fetching source content:', error);
    return '';
  }
}