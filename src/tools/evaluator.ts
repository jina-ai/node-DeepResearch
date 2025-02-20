import {z} from 'zod';
import {GenerateObjectResult} from 'ai';
import {TokenTracker} from "../utils/token-tracker";
import {AnswerAction, EvaluationCriteria, EvaluationResponse, EvaluationType} from '../types';
import {readUrl, removeAllLineBreaks} from "./read";
import {ObjectGeneratorSafe} from "../utils/safe-generator";
import {ActionTracker} from "../utils/action-tracker";


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
    days_ago: z.number().describe('Inferred dates or timeframes mentioned in the answer and relative to the current time'),
    max_age_days: z.number().optional().describe('Maximum allowed age in days before content is considered outdated')
  })
});

const pluralitySchema = z.object({
  ...baseSchema,
  type: z.literal('plurality'),
  plurality_analysis: z.object({
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
  return `You are an evaluator that analyzes if answer content is likely outdated based on mentioned dates (or implied datetime) and current system time: ${currentTime}

<rules>
Question-Answer Freshness Checker Guidelines

# Revised QA Type Maximum Age Table

| QA Type                  | Max Age (Days) | Notes                                                                 |
|--------------------------|--------------|-----------------------------------------------------------------------|
| Financial Data (Real-time)| 0.1        | Stock prices, exchange rates, crypto (real-time preferred)             |
| Breaking News            | 1           | Immediate coverage of major events                                     |
| News/Current Events      | 1           | Time-sensitive news, politics, or global events                        |
| Weather Forecasts        | 1           | Accuracy drops significantly after 24 hours                            |
| Sports Scores/Events     | 1           | Live updates required for ongoing matches                              |
| Security Advisories      | 1           | Critical security updates and patches                                  |
| Social Media Trends      | 1           | Viral content, hashtags, memes                                         |
| Cybersecurity Threats    | 7           | Rapidly evolving vulnerabilities/patches                               |
| Tech News                | 7           | Technology industry updates and announcements                          |
| Political Developments   | 7           | Legislative changes, political statements                              |
| Political Elections      | 7           | Poll results, candidate updates                                        |
| Sales/Promotions         | 7           | Limited-time offers and marketing campaigns                            |
| Travel Restrictions      | 7           | Visa rules, pandemic-related policies                                  |
| Entertainment News       | 14          | Celebrity updates, industry announcements                              |
| Product Launches         | 14          | New product announcements and releases                                 |
| Market Analysis          | 14          | Market trends and competitive landscape                                |
| Competitive Intelligence | 21          | Analysis of competitor activities and market position                  |
| Product Recalls          | 30          | Safety alerts or recalls from manufacturers                            |
| Industry Reports         | 30          | Sector-specific analysis and forecasting                               |
| Software Version Info    | 30          | Updates, patches, and compatibility information                        |
| Legal/Regulatory Updates | 30          | Laws, compliance rules (jurisdiction-dependent)                        |
| Economic Forecasts       | 30          | Macroeconomic predictions and analysis                                 |
| Consumer Trends          | 45          | Shifting consumer preferences and behaviors                            |
| Scientific Discoveries   | 60          | New research findings and breakthroughs (includes all scientific research) |
| Healthcare Guidelines    | 60          | Medical recommendations and best practices (includes medical guidelines)|
| Environmental Reports    | 60          | Climate and environmental status updates                               |
| Best Practices           | 90          | Industry standards and recommended procedures                          |
| API Documentation        | 90          | Technical specifications and implementation guides                     |
| Tutorial Content         | 180         | How-to guides and instructional materials (includes educational content)|
| Tech Product Info        | 180         | Product specs, release dates, or pricing                               |
| Statistical Data         | 180         | Demographic and statistical information                                |
| Reference Material       | 180         | General reference information and resources                            |
| Historical Content       | 365         | Events and information from the past year                              |
| Cultural Trends          | 730         | Shifts in language, fashion, or social norms                           |
| Entertainment Releases   | 730         | Movie/TV show schedules, media catalogs                                |
| Factual Knowledge        | ∞           | Static facts (e.g., historical events, geography, physical constants)   |

### Implementation Notes:
1. **Contextual Adjustment**: Freshness requirements may change during crises or rapid developments in specific domains.
2. **Tiered Approach**: Consider implementing urgency levels (critical, important, standard) alongside age thresholds.
3. **User Preferences**: Allow customization of thresholds for specific query types or user needs.
4. **Source Reliability**: Pair freshness metrics with source credibility scores for better quality assessment.
5. **Domain Specificity**: Some specialized fields (medical research during pandemics, financial data during market volatility) may require dynamically adjusted thresholds.
6. **Geographic Relevance**: Regional considerations may alter freshness requirements for local regulations or events.
</rules>

Now evaluate this pair:
Question: ${JSON.stringify(question)}
Answer: ${JSON.stringify(answer)}`;
}

function getPluralityPrompt(question: string, answer: string): string {
  return `You are an evaluator that analyzes if answers provide the appropriate number of items requested in the question.

<rules>
Question Type Reference Table

| Question Type | Expected Items | Evaluation Rules |
|---------------|----------------|------------------|
| Explicit Count | Exact match to number specified | Provide exactly the requested number of distinct, non-redundant items relevant to the query. |
| Numeric Range | Any number within specified range | Ensure count falls within given range with distinct, non-redundant items. For "at least N" queries, meet minimum threshold. |
| Implied Multiple | ≥ 2 | Provide multiple items (typically 2-4 unless context suggests more) with balanced detail and importance. |
| "Few" | 2-4 | Offer 2-4 substantive items prioritizing quality over quantity. |
| "Several" | 3-7 | Include 3-7 items with comprehensive yet focused coverage, each with brief explanation. |
| "Many" | 7+ | Present 7+ items demonstrating breadth, with concise descriptions per item. |
| "Most important" | Top 3-5 by relevance | Prioritize by importance, explain ranking criteria, and order items by significance. |
| "Top N" | Exactly N, ranked | Provide exactly N items ordered by importance/relevance with clear ranking criteria. |
| "Pros and Cons" | ≥ 2 of each category | Present balanced perspectives with at least 2 items per category addressing different aspects. |
| "Compare X and Y" | ≥ 3 comparison points | Address at least 3 distinct comparison dimensions with balanced treatment covering major differences/similarities. |
| "Steps" or "Process" | All essential steps | Include all critical steps in logical order without missing dependencies. |
| "Examples" | ≥ 3 unless specified | Provide at least 3 diverse, representative, concrete examples unless count specified. |
| "Comprehensive" | 10+ | Deliver extensive coverage (10+ items) across major categories/subcategories demonstrating domain expertise. |
| "Brief" or "Quick" | 1-3 | Present concise content (1-3 items) focusing on most important elements described efficiently. |
| "Complete" | All relevant items | Provide exhaustive coverage within reasonable scope without major omissions, using categorization if needed. |
| "Thorough" | 7-10 | Offer detailed coverage addressing main topics and subtopics with both breadth and depth. |
| "Overview" | 3-5 | Cover main concepts/aspects with balanced coverage focused on fundamental understanding. |
| "Summary" | 3-5 key points | Distill essential information capturing main takeaways concisely yet comprehensively. |
| "Main" or "Key" | 3-7 | Focus on most significant elements fundamental to understanding, covering distinct aspects. |
| "Essential" | 3-7 | Include only critical, necessary items without peripheral or optional elements. |
| "Basic" | 2-5 | Present foundational concepts accessible to beginners focusing on core principles. |
| "Detailed" | 5-10 with elaboration | Provide in-depth coverage with explanations beyond listing, including specific information and nuance. |
| "Common" | 4-8 most frequent | Focus on typical or prevalent items, ordered by frequency when possible, that are widely recognized. |
| "Primary" | 2-5 most important | Focus on dominant factors with explanation of their primacy and outsized impact. |
| "Secondary" | 3-7 supporting items | Present important but not critical items that complement primary factors and provide additional context. |
| Unspecified Analysis | 3-5 key points | Default to 3-5 main points covering primary aspects with balanced breadth and depth. |
</rules>

Now evaluate this pair:
Question: ${JSON.stringify(question)}
Answer: ${JSON.stringify(answer)}`;
}


const questionEvaluationSchema = z.object({
  needsFreshness: z.boolean().describe('Whether the question requires freshness check'),
  needsPlurality: z.boolean().describe('Whether the question requires plurality check'),
  think: z.string().describe('Explanation of why these checks are needed or not needed'),
  languageStyle: z.string().describe('The language being used and the overall vibe/mood of the question'),
});

function getQuestionEvaluationPrompt(question: string): string {
  return `You are an evaluator that determines if a question requires freshness and/or plurality checks in addition to the required definitiveness check.

<evaluation_types>
1. freshness - Checks if the question is time-sensitive or requires very recent information
2. plurality - Checks if the question asks for multiple items or a specific count or enumeration
3. language style - Identifies both the language used and the overall vibe of the question
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

3. Language Style Analysis:
  Combine both language and emotional vibe in a descriptive phrase, considering:
  - Language: The primary language or mix of languages used
  - Emotional tone: panic, excitement, frustration, curiosity, etc.
  - Formality level: academic, casual, professional, etc.
  - Domain context: technical, academic, social, etc.
</rules>

<examples>
Question: "fam PLEASE help me calculate the eigenvalues of this 4x4 matrix ASAP!! [matrix details] got an exam tmrw 😭"
Evaluation: {
    "needsFreshness": false,
    "needsPlurality": true,
    "think": "Multiple eigenvalues needed but no time-sensitive information required",
    "languageStyle": "panicked student English with math jargon"
}

Question: "Can someone explain how tf did Ferrari mess up their pit stop strategy AGAIN?! 🤦‍♂️ #MonacoGP"
Evaluation: {
    "needsFreshness": true,
    "needsPlurality": true,
    "think": "Refers to recent race event and requires analysis of multiple strategic decisions",
    "languageStyle": "frustrated fan English with F1 terminology"
}

Question: "肖老师您好，请您介绍一下最近量子计算领域的三个重大突破，特别是它们在密码学领域的应用价值吗？🤔"
Evaluation: {
    "needsFreshness": true,
    "needsPlurality": true,
    "think": "Asks for recent breakthroughs (freshness) and specifically requests three examples (plurality)",
    "languageStyle": "formal technical Chinese with academic undertones"
}

Question: "Bruder krass, kannst du mir erklären warum meine neural network training loss komplett durchdreht? Hab schon alles probiert 😤"
Evaluation: {
    "needsFreshness": false,
    "needsPlurality": true,
    "think": "Requires comprehensive debugging analysis of multiple potential issues",
    "languageStyle": "frustrated German-English tech slang"
}

Question: "Does anyone have insights into the sociopolitical implications of GPT-4's emergence in the Global South, particularly regarding indigenous knowledge systems and linguistic diversity? Looking for a nuanced analysis."
Evaluation: {
    "needsFreshness": true,
    "needsPlurality": true,
    "think": "Requires analysis of current impacts (freshness) across multiple dimensions: sociopolitical, cultural, and linguistic (plurality)",
    "languageStyle": "formal academic English with sociological terminology"
}
</examples>

Now evaluate this question:
Question: ${JSON.stringify(question)}`;
}

const TOOL_NAME = 'evaluator';

export async function evaluateQuestion(
  question: string,
  tracker?: TokenTracker
): Promise<EvaluationCriteria> {
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
    return {types, languageStyle: result.object.languageStyle};

  } catch (error) {
    console.error('Error in question evaluation:', error);
    // Default to all evaluation types in case of error
    return {types: ['definitive', 'freshness', 'plurality'], languageStyle: 'plain English'};
  }
}


async function performEvaluation<T>(
  evaluationType: EvaluationType,
  params: {
    schema: z.ZodType<T>;
    prompt: string;
  },
  trackers: [TokenTracker, ActionTracker],
): Promise<GenerateObjectResult<T>> {
  const generator = new ObjectGeneratorSafe(trackers[0]);

  const result = await generator.generateObject({
    model: TOOL_NAME,
    schema: params.schema,
    prompt: params.prompt,
  }) as GenerateObjectResult<any>;

  trackers[1].trackThink(result.object.think)

  console.log(`${evaluationType} ${TOOL_NAME}`, result.object);

  return result;
}


// Main evaluation function
export async function evaluateAnswer(
  question: string,
  action: AnswerAction,
  evaluationCri: EvaluationCriteria,
  trackers: [TokenTracker, ActionTracker],
  visitedURLs: string[] = []
): Promise<{ response: EvaluationResponse }> {
  let result;

  // Only add attribution if we have valid references
  if (action.references && action.references.length > 0 && action.references.some(ref => ref.url.startsWith('http'))) {
    evaluationCri.types = ['attribution', ...evaluationCri.types];
  }

  for (const evaluationType of evaluationCri.types) {
    switch (evaluationType) {
      case 'attribution': {
        // Safely handle references and ensure we have content
        const urls = action.references?.filter(ref => ref.url.startsWith('http') && !visitedURLs.includes(ref.url)).map(ref => ref.url) || [];
        const uniqueURLs = [...new Set(urls)];

        if (uniqueURLs.length === 0) {
          // all URLs have been read, or there is no valid urls. no point to read them.
          result = {
            object: {
              pass: true,
              think: "All provided references have been visited and no new URLs were found to read. The answer is considered valid without further verification.",
              type: 'attribution',
            } as EvaluationResponse
          }
          break;
        }

        const allKnowledge = await fetchSourceContent(uniqueURLs, trackers);

        if (!allKnowledge.trim()) {
          return {
            response: {
              pass: false,
              think: `The answer does provide URL references ${JSON.stringify(uniqueURLs)}, but the content could not be fetched or is empty. Need to found some other references and URLs`,
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
          trackers
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
          trackers
        );
        break;

      case 'freshness':
        result = await performEvaluation(
          'freshness',
          {
            schema: freshnessSchema,
            prompt: getFreshnessPrompt(question, action.answer, new Date().toISOString()),
          },
          trackers
        );
        break;

      case 'plurality':
        result = await performEvaluation(
          'plurality',
          {
            schema: pluralitySchema,
            prompt: getPluralityPrompt(question, action.answer),
          },
          trackers
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
async function fetchSourceContent(urls: string[], trackers: [TokenTracker, ActionTracker]): Promise<string> {
  if (!urls.length) return '';
  trackers[1].trackThink('Let me fetch the source content to verify the answer.');
  try {
    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          const {response} = await readUrl(url, trackers[0]);
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