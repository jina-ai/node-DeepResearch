import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { readUrl } from "./tools/read";
import fs from 'fs/promises';
import { SafeSearchType, search } from "duck-duck-scrape";
import { rewriteQuery } from "./tools/query-rewriter";
import { dedupQueries } from "./tools/dedup";
import { evaluateAnswer } from "./tools/evaluator";
import { StepData } from "./tools/getURLIndex";
import { analyzeSteps } from "./tools/error-analyzer";
import { GEMINI_API_KEY, JINA_API_KEY, MODEL_NAME } from "./config";
import { tokenTracker } from "./utils/token-tracker";

async function sleep(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  console.log(`Waiting ${seconds}s...`);
  return new Promise(resolve => setTimeout(resolve, ms));
}

type ResponseSchema = {
  type: SchemaType.OBJECT;
  properties: {
    action: {
      type: SchemaType.STRING;
      enum: string[];
      description: string;
    };
    searchQuery: {
      type: SchemaType.STRING;
      description: string;
    };
    URLTargets?: {
      type: SchemaType.ARRAY;
      items: {
        type: SchemaType.STRING;
      };
      maxItems: number;
      description: string;
    };
    answer: {
      type: SchemaType.STRING;
      description: string;
    };
    references: {
      type: SchemaType.ARRAY;
      items: {
        type: SchemaType.OBJECT;
        properties: {
          exactQuote: {
            type: SchemaType.STRING;
            description: string;
          };
          url: {
            type: SchemaType.STRING;
            description: string;
          };
        };
        required: string[];
      };
      description: string;
    };
    reasoning: {
      type: SchemaType.STRING;
      description: string;
    };
    questionsToAnswer?: {
      type: SchemaType.ARRAY;
      items: {
        type: SchemaType.STRING;
        description: string;
      };
      description: string;
      maxItems: number;
    };
  };
  required: string[];
};

function getSchema(allowReflect: boolean, allowRead: boolean): ResponseSchema {
  const actions = ["search", "answer"];
  if (allowReflect) {
    actions.push("reflect");
  }
  if (allowRead) {
    actions.push("visit");
  }
  return {
    type: SchemaType.OBJECT,
    properties: {
      action: {
        type: SchemaType.STRING,
        enum: actions,
        description: "Must match exactly one action type"
      },
      questionsToAnswer: allowReflect ? {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.STRING,
          description: "each question must be a single line, concise and clear. not composite or compound, less than 20 words.",
        },
        description: "Only required when choosing 'reflect' action, list of most important questions to answer to fill the knowledge gaps.",
        maxItems: 2
      } : undefined,
      searchQuery: {
        type: SchemaType.STRING,
        description: "Only required when choosing 'search' action, must be a short, keyword-based query that BM25, tf-idf based search engines can understand.",
      },
      URLTargets: allowRead ? {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.STRING
        },
        maxItems: 2,
        description: "Only required when choosing 'deep dive' action, must be an array of URLs, choose up the most relevant 3 URLs to deep dive into"
      } : undefined,
      answer: {
        type: SchemaType.STRING,
        description: "Only required when choosing 'answer' action, must be the final answer in natural language"
      },
      references: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            exactQuote: {
              type: SchemaType.STRING,
              description: "Exact relevant quote from the document",
            },
            url: {
              type: SchemaType.STRING,
              description: "URL of the document; must be directly from the context"
            },
          },
          required: ["exactQuote", "url"]
        },
        description: "Only required when choosing 'answer' action, must be an array of references"
      },
      reasoning: {
        type: SchemaType.STRING,
        description: "Explain why choose this action?"
      },
    },
    required: ["action", "reasoning"],
  };
}

function getPrompt(question: string, context?: any[], allQuestions?: string[], allowReflect: boolean = false, badContext?: any[], knowledge?: any[], allURLs?: Record<string, string>) {


  const knowledgeIntro = knowledge?.length ?
    `
## Knowledge
You have successfully gathered some knowledge which might be useful for answering the original question. Here is the knowledge you have gathered so far

${knowledge.map((k, i) => `
### Knowledge ${i + 1}: ${k.question}
${k.answer}
`).join('\n')}

`
    : '';

  const badContextIntro = badContext?.length ?
    `
## Unsuccessful Attempts
Your have tried the following actions but failed to find the answer to the question.

${badContext.map((c, i) => `
### Attempt ${i + 1}
- Recap: ${c.recap}
- Blame: ${c.blame}
- Improvement: ${c.improvement}
`).join('\n')}`
    : '';

  const contextIntro = context?.length ?
    `
## Context
You have conducted the following actions:

${context.join('\n')}

`
    : '';

  let actionsDescription = `
## Actions

When you are uncertain about the answer and you need knowledge, choose one of these actions to proceed:

${allURLs ? `
**visit**:
- Visit any URLs from below to gather external knowledge, choose the most relevant URLs that might contain the answer

${Object.keys(allURLs).map(url => `
  + "${url}": "${allURLs[url]}"`).join('')}

- When you have enough search result in the context and want to deep dive into specific URLs
- It allows you to access the full content behind any URLs
` : ''}

**search**:
- Query external sources using a public search engine
- Focus on solving one specific aspect of the question
- Only give keywords search query, not full sentences

**answer**:
- Provide final response only when 100% certain
- Responses must be definitive (no ambiguity, uncertainty, or disclaimers)
${allowReflect ? `- If doubts remain, use "reflect" instead` : ''}`;

  if (allowReflect) {
    actionsDescription += `

**reflect**:
- Perform critical analysis through hypothetical scenarios or systematic breakdowns
- Identify knowledge gaps and formulate essential clarifying questions
- Questions must be:
  - Original (not variations of existing questions)
  - Focused on single concepts
  - Under 20 words
  - Non-compound/non-complex
`;
  }

  return `
Current date: ${new Date().toUTCString()}  

You are an advanced AI research analyst specializing in multi-step reasoning. Using your training data and prior lessons learned, answer the following question with absolute certainty:

## Question
${question}

${contextIntro.trim()}

${knowledgeIntro.trim()}

${badContextIntro.trim()}

${actionsDescription.trim()}

Respond exclusively in valid JSON format matching exact JSON schema.

Critical Requirements:
- Include ONLY ONE action type
- Never add unsupported keys
- Exclude all non-JSON text, markdown, or explanations
- Maintain strict JSON syntax`.trim();
}

const context: StepData[] = [];  // successful steps in the current session
const allContext: StepData[] = [];  // all steps in the current session, including those leads to wrong results

function updateContext(step: any) {
  context.push(step);
  allContext.push(step)
}

function removeAllLineBreaks(text: string) {
    return text.replace(/(\r\n|\n|\r)/gm, " ");
}

async function getResponse(question: string) {
  let step = 0;
  let totalStep = 0;
  let badAttempts = 0;
  const gaps: string[] = [question];  // All questions to be answered including the orginal question
  const allQuestions = [question];
  const allKeywords = [];
  const allKnowledge = [];  // knowledge are intermedidate questions that are answered
  const badContext = [];
  let diaryContext = [];
  const allURLs: Record<string, string> = {};
  const currentQuestion = gaps.length > 0 ? gaps.shift()! : question;
  while (gaps.length > 0 || currentQuestion === question) {
    // add 1s delay to avoid rate limiting
    await sleep(1000);
    step++;
    totalStep++;
    console.log(`Step ${totalStep}: Processing ${gaps.length} remaining questions`);
    const allowReflect = gaps.length <= 1;
    // update all urls with buildURLMap
    const allowRead = Object.keys(allURLs).length > 0;
    const prompt = getPrompt(
      currentQuestion,
      diaryContext,
      allQuestions,
      allowReflect,
      badContext,
      allKnowledge,
      allURLs);


    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        temperature: 0.7,
        responseMimeType: "application/json",
        responseSchema: getSchema(allowReflect, allowRead)
      }
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const usage = response.usageMetadata;
    tokenTracker.trackUsage('agent', usage?.totalTokenCount || 0);



    const action = JSON.parse(response.text());


    if (action.action === 'answer') {
      updateContext({
        step,
        question: currentQuestion,
        ...action,
      });

      const { response: evaluation } = await evaluateAnswer(currentQuestion, action.answer);


      if (currentQuestion === question) {
        if (badAttempts >= 3) {
          // EXIT POINT OF THE PROGRAM!!!!
          diaryContext.push(`
At step ${step} and ${badAttempts} attempts, you took **answer** action and found an answer, not a perfect one but good enough to answer the original question:

Original question: 
${currentQuestion}

Your answer: 
${action.answer}

The evaluator thinks your answer is good because: 
${evaluation.reasoning}

Your journey ends here.
`);
          console.log('Final Answer:', action.answer);
          tokenTracker.printSummary();
          await storeContext(prompt, [allContext, allKeywords, allQuestions, allKnowledge], totalStep);
          return action;
        }
        if (evaluation.is_valid_answer) {
          if (action.references.length > 0 || Object.keys(allURLs).length === 0) {
          // EXIT POINT OF THE PROGRAM!!!!
          diaryContext.push(`
At step ${step}, you took **answer** action and finally found the answer to the original question:

Original question: 
${currentQuestion}

Your answer: 
${action.answer}

The evaluator thinks your answer is good because: 
${evaluation.reasoning}

Your journey ends here. You have successfully answered the original question. Congratulations! 🎉
`);
          console.log('Final Answer:', action.answer);
          tokenTracker.printSummary();
          await storeContext(prompt, [allContext, allKeywords, allQuestions, allKnowledge], totalStep);
          return action;
          } else {
            diaryContext.push(`
At step ${step}, you took **answer** action and finally found the answer to the original question:

Original question: 
${currentQuestion}

Your answer: 
${action.answer}

Unfortunately, you did not provide any references to support your answer. 
You need to find more URL references to support your answer.`);
          }

        } else {
          diaryContext.push(`
At step ${step}, you took **answer** action but evaluator thinks it is not a good answer:

Original question: 
${currentQuestion}

Your answer: 
${action.answer}

The evaluator thinks your answer is bad because: 
${evaluation.reasoning}
`);
          // store the bad context and reset the diary context
          const { response: errorAnalysis } = await analyzeSteps(diaryContext);

          badContext.push(errorAnalysis);
          badAttempts++;
          diaryContext = [];
          step = 0;
        }
      } else if (evaluation.is_valid_answer) {
        diaryContext.push(`
At step ${step}, you took **answer** action. You found a good answer to the sub-question:

Sub-question: 
${currentQuestion}

Your answer: 
${action.answer}

The evaluator thinks your answer is good because: 
${evaluation.reasoning}

Although you solved a sub-question, you still need to find the answer to the original question. You need to keep going.
`);
        allKnowledge.push({question: currentQuestion, answer: action.answer});
      }
    }
    else if (action.action === 'reflect' && action.questionsToAnswer) {
      let newGapQuestions = action.questionsToAnswer
      const oldQuestions = newGapQuestions;
      if (allQuestions.length) {
        newGapQuestions = await dedupQueries(newGapQuestions, allQuestions)
      }
      if (newGapQuestions.length > 0) {
        // found new gap questions
        diaryContext.push(`
At step ${step}, you took **reflect** and think about the knowledge gaps. You found some sub-questions are important to the question: "${currentQuestion}"
You realize you need to know the answers to the following sub-questions:
${newGapQuestions.map((q: string) => `- ${q}`).join('\n')}

You will now figure out the answers to these sub-questions and see if they can help me find the answer to the original question.
`);
        gaps.push(...newGapQuestions);
        allQuestions.push(...newGapQuestions);
        gaps.push(question);  // always keep the original question in the gaps
      } else {
        diaryContext.push(`
At step ${step}, you took **reflect** and think about the knowledge gaps. You tried to break down the question "${currentQuestion}" into gap-questions like this: ${oldQuestions.join(', ')} 
But then you realized you have asked them before. You decided to to think out of the box or cut from a completely different angle. 
`);
        updateContext({
          step,
          ...action,
          result: 'I have tried all possible questions and found no useful information. I must think out of the box or different angle!!!'
        });
      }
    }
    else if (action.action === 'search' && action.searchQuery) {
        // rewrite queries
        let { keywords: keywordsQueries } = await rewriteQuery(action.searchQuery);

        const oldKeywords = keywordsQueries;
        // avoid exisitng searched queries
        if (allKeywords.length) {
          const { unique_queries: dedupedQueries } = await dedupQueries(keywordsQueries, allKeywords);
          keywordsQueries = dedupedQueries;
        }
        if (keywordsQueries.length > 0) {
          const searchResults = [];
          for (const query of keywordsQueries) {
            console.log(`Search query: ${query}`);
            const results = await search(query, {
              safeSearch: SafeSearchType.STRICT
            });
            const minResults = results.results.map(r => ({
              title: r.title,
              url: r.url,
              description: r.description,
            }));
            for (const r of minResults) {
              allURLs[r.url] = r.title;
            }
            searchResults.push({query, results: minResults});
            allKeywords.push(query);
            await sleep(5000);
          }
            diaryContext.push(`
At step ${step}, you took the **search** action and look for external information for the question: "${currentQuestion}".
In particular, you tried to search for the following keywords: "${keywordsQueries.join(', ')}".
You found quite some information and add them to your URL list and **visit** them later when needed. 
`);

          updateContext({
            step,
            question: currentQuestion,
            ...action,
            result: searchResults
          });
        } else {
          diaryContext.push(`
At step ${step}, you took the **search** action and look for external information for the question: "${currentQuestion}".
In particular, you tried to search for the following keywords: ${oldKeywords.join(', ')}. 
But then you realized you have already searched for these keywords before.
You decided to think out of the box or cut from a completely different angle.
`);


          updateContext({
            step,
            ...action,
            result: 'I have tried all possible queries and found no new information. I must think out of the box or different angle!!!'
          });
        }
      }
    else if (action.action === 'visit' && action.URLTargets?.length) {
        const urlResults = await Promise.all(
          action.URLTargets.map(async (url: string) => {
            const { response, tokens } = await readUrl(url, JINA_API_KEY);
            allKnowledge.push({
              question: `What is in ${response.data.url}?`,
              answer: removeAllLineBreaks(response.data.content)});
            // remove that url from allURLs
            delete allURLs[url];
            return {url, result: response, tokens};
          })
        );
        diaryContext.push(`
At step ${step}, you took the **visit** action and deep dive into the following URLs:
${action.URLTargets.join('\n')}
You found some useful information on the web and add them to your knowledge for future reference.
`);
        updateContext({
          step,
          question: currentQuestion,
          ...action,
          result: urlResults
        });


      }

    await storeContext(prompt, [allContext, allKeywords, allQuestions, allKnowledge], totalStep);
  }
}

async function storeContext(prompt: string, memory: any[][], step: number) {
  try {
    await fs.writeFile(`prompt-${step}.txt`, prompt);
    const [context, keywords, questions, knowledge] = memory;
    await fs.writeFile('context.json', JSON.stringify(context, null, 2));
    await fs.writeFile('keywords.json', JSON.stringify(keywords, null, 2));
    await fs.writeFile('questions.json', JSON.stringify(questions, null, 2));
    await fs.writeFile('knowledge.json', JSON.stringify(knowledge, null, 2));
  } catch (error) {
    console.error('Context storage failed:', error);
  }
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const question = process.argv[2] || "";
getResponse(question);
