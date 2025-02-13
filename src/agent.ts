import {z, ZodObject} from 'zod';
import {CoreAssistantMessage, CoreUserMessage} from 'ai';
import {SEARCH_PROVIDER, STEP_SLEEP} from "./config";
import {readUrl, removeAllLineBreaks} from "./tools/read";
import fs from 'fs/promises';
import {SafeSearchType, search as duckSearch} from "duck-duck-scrape";
import {braveSearch} from "./tools/brave-search";
import {rewriteQuery} from "./tools/query-rewriter";
import {dedupQueries} from "./tools/jina-dedup";
import {evaluateAnswer, evaluateQuestion} from "./tools/evaluator";
import {analyzeSteps} from "./tools/error-analyzer";
import {TokenTracker} from "./utils/token-tracker";
import {ActionTracker} from "./utils/action-tracker";
import {StepAction, AnswerAction, KnowledgeItem} from "./types";
import {TrackerContext} from "./types";
import {search} from "./tools/jina-search";
// import {grounding} from "./tools/grounding";
import {zodToJsonSchema} from "zod-to-json-schema";
import {ObjectGeneratorSafe} from "./utils/safe-generator";

async function sleep(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  console.log(`Waiting ${seconds}s...`);
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getSchema(allowReflect: boolean, allowRead: boolean, allowAnswer: boolean, allowSearch: boolean) {
  const actions: string[] = [];
  const properties: Record<string, z.ZodTypeAny> = {
    action: z.enum(['placeholder']), // Will update later with actual actions
    think: z.string().describe("Explain why choose this action, what's the thought process behind choosing this action")
  };

  if (allowSearch) {
    actions.push("search");
    properties.searchQuery = z.string().max(30)
      .describe("Required when action='search'. Must be a short, keyword-based query that BM25, tf-idf based search engines can understand. Existing queries must be avoided").optional();
  }

  if (allowAnswer) {
    actions.push("answer");
    properties.answer = z.string()
      .describe("Required when action='answer'. Must be the final answer in natural language").optional();
    properties.references = z.array(
      z.object({
        exactQuote: z.string().describe("Exact relevant quote from the document"),
        url: z.string().describe("source URL; must be directly from the context")
      }).required()
    ).describe("Required when action='answer'. Must be an array of references that support the answer, each reference must contain an exact quote and the URL of the document").optional();
  }

  if (allowReflect) {
    actions.push("reflect");
    properties.questionsToAnswer = z.array(
      z.string().describe("each question must be a single line, concise and clear. not composite or compound, less than 20 words.")
    ).max(2)
      .describe("Required when action='reflect'. List of most important questions to fill the knowledge gaps of finding the answer to the original question").optional();
  }

  if (allowRead) {
    actions.push("visit");
    properties.URLTargets = z.array(z.string())
      .max(2)
      .describe("Required when action='visit'. Must be an array of URLs, choose up the most relevant 2 URLs to visit").optional();
  }

  // Update the enum values after collecting all actions
  properties.action = z.enum(actions as [string, ...string[]])
    .describe("Must match exactly one action type");

  return z.object(properties);

}


function getPrompt(
  question: string,
  context?: string[],
  allQuestions?: string[],
  allKeywords?: string[],
  allowReflect: boolean = true,
  allowAnswer: boolean = true,
  allowRead: boolean = true,
  allowSearch: boolean = true,
  badContext?: { question: string, answer: string, evaluation: string, recap: string; blame: string; improvement: string; }[],
  knowledge?: KnowledgeItem[],
  allURLs?: Record<string, string>,
  beastMode?: boolean
): string {
  const sections: string[] = [];
  const actionSections: string[] = [];

  // Add header section
  sections.push(`Current date: ${new Date().toUTCString()}

You are an advanced AI research agent from Jina AI. You are specialized in multistep reasoning. Using your training data and prior lessons learned, answer the following question with absolute certainty:

<question>
${question}
</question>
`);

  // Add context section if exists
  if (context?.length) {
    sections.push(`
You have conducted the following actions:
<context>
${context.join('\n')}

</context>
`);
  }

  // Add knowledge section if exists
  if (knowledge?.length) {
    const knowledgeItems = knowledge
      .map((k, i) => `
<knowledge-${i + 1}>
<question>
${k.question}
</question>
<answer>
${k.answer}
</answer>
${k.references ? `
<references>
${JSON.stringify(k.references)}
</references>
` : ''}
</knowledge-${i + 1}>
`)
      .join('\n\n');

    sections.push(`
You have successfully gathered some knowledge which might be useful for answering the original question. Here is the knowledge you have gathered so far:
<knowledge>

${knowledgeItems}

</knowledge>
`);
  }

  // Add bad context section if exists
  if (badContext?.length) {
    const attempts = badContext
      .map((c, i) => `
<attempt-${i + 1}>
- Question: ${c.question}
- Answer: ${c.answer}
- Reject Reason: ${c.evaluation}
- Actions Recap: ${c.recap}
- Actions Blame: ${c.blame}
</attempt-${i + 1}>
`)
      .join('\n\n');

    const learnedStrategy = badContext.map(c => c.improvement).join('\n');

    sections.push(`
Your have tried the following actions but failed to find the answer to the question:
<bad-attempts>    

${attempts}

</bad-attempts>

Based on the failed attempts, you have learned the following strategy:
<learned-strategy>
${learnedStrategy}
</learned-strategy>
`);
  }

  // Build actions section

  if (allowRead) {
    let urlList = '';
    if (allURLs && Object.keys(allURLs).length > 0) {
      urlList = Object.entries(allURLs)
        .map(([url, desc]) => `  + "${url}": "${desc}"`)
        .join('\n');
    }

    actionSections.push(`
<action-visit>
- This allows you to access the full content behind any URLs.
- If the <question> contains a URL, you must visit the URL to gather more information.
${urlList ? `    
- Visit any URLs from below to gather external knowledge, choose the most relevant URLs that might contain the answer
<url-list>
${urlList}
</url-list>
`.trim() : ''}
</action-visit>
`);
  }

  if (allowSearch) {

    actionSections.push(`
<action-search>    
${allKeywords?.length ? `
- Avoid the searched queries below as they do not give any useful information, you need to think out of the box and propose queries from a completely different angle:
<bad-queries>
${allKeywords.join('\n')}
</bad-queries>
`.trim() : ''}
- Propose some unique new queries that might help you find the answer to the question
- Focus on solving one specific aspect of the original question
- Only use keywords, not full sentences
</action-search>
`);
  }

  if (allowAnswer) {
    actionSections.push(`
<action-answer>
- If <question> is a simple greeting, chit-chat, or general knowledge, provide the answer directly.
- Must provide "references" and each must specify "exactQuote" and "url" 
- In the answer, use markdown footnote syntax like [^1], [^2] to refer to the references
- Responses must be definitive (no ambiguity, uncertainty, or disclaimers)
- Provide final response only when 100% certain${allowReflect ? '\n- If doubts remain, use <action-reflect> instead' : ''}
</action-answer>
`);
  }

  if (beastMode) {
    actionSections.push(`
<action-answer>
- Any answer is better than no answer
- Partial answers are allowed, but make sure they are based on the context and knowledge you have gathered    
- When uncertain, educated guess based on the context and knowledge is allowed and encouraged.
- Responses must be definitive (no ambiguity, uncertainty, or disclaimers)
</action-answer>
`);
  }

  if (allowReflect) {
    actionSections.push(`
<action-reflect>    
- Perform critical analysis through hypothetical scenarios or systematic breakdowns
- Identify knowledge gaps and formulate essential clarifying questions
- Questions must be:
  - Original (not variations of existing questions)
  - Focused on single concepts
  - Under 20 words
  - Non-compound/non-complex
</action-reflect>
`);
  }

  sections.push(`
Based on the current context, you must choose one of the following actions:
<actions>
${actionSections.join('\n\n')}
</actions>
`);

  // Add footer
  sections.push(`Respond exclusively in valid JSON format matching exact JSON schema.

Critical Requirements:
- Include ONLY ONE action type
- Never add unsupported keys
- Exclude all non-JSON text, markdown, or explanations
- Maintain strict JSON syntax`);

  return removeExtraLineBreaks(sections.join('\n\n'));
}

const removeExtraLineBreaks = (text: string) => {
  return text.replace(/\n{2,}/gm, '\n\n');
}

const allContext: StepAction[] = [];  // all steps in the current session, including those leads to wrong results

function updateContext(step: any) {
  allContext.push(step)
}


function removeHTMLtags(text: string) {
  return text.replace(/<[^>]*>?/gm, '');
}


export async function getResponse(question: string,
                                  tokenBudget: number = 1_000_000,
                                  maxBadAttempts: number = 3,
                                  existingContext?: Partial<TrackerContext>,
                                  historyMessages?: Array<CoreAssistantMessage | CoreUserMessage>
): Promise<{ result: StepAction; context: TrackerContext }> {
  const context: TrackerContext = {
    tokenTracker: existingContext?.tokenTracker || new TokenTracker(tokenBudget),
    actionTracker: existingContext?.actionTracker || new ActionTracker()
  };
  let step = 0;
  let totalStep = 0;
  let badAttempts = 0;
  let schema: ZodObject<any> = getSchema(true, true, true, true)
  const gaps: string[] = [question.trim()];  // All questions to be answered including the orginal question
  const allQuestions = [question.trim()];
  const allKeywords = [];
  const allKnowledge: KnowledgeItem[] = [];  // knowledge are intermedidate questions that are answered
  // iterate over historyMessages
  // if role is user and content is question, add to allQuestions, the next assistant content should be the answer
  // put this pair to the allKnowledge
  historyMessages?.forEach((message, i) => {
    if (message.role === 'user' && message.content && historyMessages[i + 1]?.role === 'assistant') {
      allQuestions.push(message.content as string)
      allKnowledge.push({
        question: message.content as string,
        answer: (historyMessages[i + 1]?.content || '') as string,
        type: 'chat-history',
        updated: new Date().toISOString()
      });
    }
  })

  const badContext = [];
  let diaryContext = [];
  let allowAnswer = true;
  let allowSearch = true;
  let allowRead = true;
  let allowReflect = true;
  let prompt = '';
  let thisStep: StepAction = {action: 'answer', answer: '', references: [], think: '', isFinal: false};

  const allURLs: Record<string, string> = {};
  const visitedURLs: string[] = [];
  const evaluationMetrics: Record<string, any[]> = {};
  while (context.tokenTracker.getTotalUsage().totalTokens < tokenBudget && badAttempts <= maxBadAttempts) {
    // add 1s delay to avoid rate limiting
    await sleep(STEP_SLEEP);
    step++;
    totalStep++;
    const budgetPercentage = (context.tokenTracker.getTotalUsage().totalTokens / tokenBudget * 100).toFixed(2);
    console.log(`Step ${totalStep} / Budget used ${budgetPercentage}%`);
    console.log('Gaps:', gaps);
    allowReflect = allowReflect && (gaps.length <= 1);
    const currentQuestion = gaps.length > 0 ? gaps.shift()! : question.trim();
    if (!evaluationMetrics[currentQuestion]) {
      evaluationMetrics[currentQuestion] = await evaluateQuestion(currentQuestion, context.tokenTracker)
    }

    // update all urls with buildURLMap
    // allowRead = allowRead && (Object.keys(allURLs).length > 0);
    allowSearch = allowSearch && (Object.keys(allURLs).length < 50);  // disable search when too many urls already

    // generate prompt for this step
    prompt = getPrompt(
      currentQuestion,
      diaryContext,
      allQuestions,
      allKeywords,
      allowReflect,
      allowAnswer,
      allowRead,
      allowSearch,
      badContext,
      allKnowledge,
      allURLs,
      false
    );
    schema = getSchema(allowReflect, allowRead, allowAnswer, allowSearch)
    const generator = new ObjectGeneratorSafe(context.tokenTracker);
    const result = await generator.generateObject({
      model: 'agent',
      schema,
      prompt,
    });
    thisStep = result.object as StepAction;
    // print allowed and chose action
    const actionsStr = [allowSearch, allowRead, allowAnswer, allowReflect].map((a, i) => a ? ['search', 'read', 'answer', 'reflect'][i] : null).filter(a => a).join(', ');
    console.log(`${thisStep.action} <- [${actionsStr}]`);
    console.log(thisStep)

    context.actionTracker.trackAction({totalStep, thisStep, gaps, badAttempts});

    // reset allowAnswer to true
    allowAnswer = true;
    allowReflect = true;
    allowRead = true;
    allowSearch = true;

    // execute the step and action
    if (thisStep.action === 'answer') {
      if (step === 1) {
        // LLM is so confident and answer immediately, skip all evaluations
        thisStep.isFinal = true;
        break
      }

      updateContext({
        totalStep,
        question: currentQuestion,
        ...thisStep,
      });

      const {response: evaluation} = await evaluateAnswer(currentQuestion, thisStep,
        evaluationMetrics[currentQuestion], context.tokenTracker);

      if (currentQuestion.trim() === question.trim()) {
        if (evaluation.pass) {
          diaryContext.push(`
At step ${step}, you took **answer** action and finally found the answer to the original question:

Original question: 
${currentQuestion}

Your answer: 
${thisStep.answer}

The evaluator thinks your answer is good because: 
${evaluation.think}

Your journey ends here. You have successfully answered the original question. Congratulations! 🎉
`);
          thisStep.isFinal = true;
          break
        } else {
          if (badAttempts >= maxBadAttempts) {
            thisStep.isFinal = false;
            break
          } else {
            diaryContext.push(`
At step ${step}, you took **answer** action but evaluator thinks it is not a good answer:

Original question: 
${currentQuestion}

Your answer: 
${thisStep.answer}

The evaluator thinks your answer is bad because: 
${evaluation.think}
`);
            // store the bad context and reset the diary context
            const {response: errorAnalysis} = await analyzeSteps(diaryContext, context.tokenTracker);

            allKnowledge.push({
              question: currentQuestion,
              answer: thisStep.answer,
              references: thisStep.references,
              type: 'qa',
              updated: new Date().toISOString()
            });

            badContext.push({
              question: currentQuestion,
              answer: thisStep.answer,
              evaluation: evaluation.think,
              ...errorAnalysis
            });

            if (errorAnalysis.questionsToAnswer) {
              // reranker? maybe
              gaps.push(...errorAnalysis.questionsToAnswer.slice(0, 2));
              allQuestions.push(...errorAnalysis.questionsToAnswer.slice(0, 2));
              gaps.push(question.trim());  // always keep the original question in the gaps
            }

            badAttempts++;
            allowAnswer = false;  // disable answer action in the immediate next step
            diaryContext = [];
            step = 0;
          }
        }
      } else if (evaluation.pass) {
        diaryContext.push(`
At step ${step}, you took **answer** action. You found a good answer to the sub-question:

Sub-question: 
${currentQuestion}

Your answer: 
${thisStep.answer}

The evaluator thinks your answer is good because: 
${evaluation.think}

Although you solved a sub-question, you still need to find the answer to the original question. You need to keep going.
`);
        allKnowledge.push({
          question: currentQuestion,
          answer: thisStep.answer,
          references: thisStep.references,
          type: 'qa',
          updated: new Date().toISOString()
        });
      }
    } else if (thisStep.action === 'reflect' && thisStep.questionsToAnswer) {
      let newGapQuestions = thisStep.questionsToAnswer
      const oldQuestions = newGapQuestions;
      newGapQuestions = (await dedupQueries(newGapQuestions, allQuestions, context.tokenTracker)).unique_queries;
      if (newGapQuestions.length > 0) {
        // found new gap questions
        diaryContext.push(`
At step ${step}, you took **reflect** and think about the knowledge gaps. You found some sub-questions are important to the question: "${currentQuestion}"
You realize you need to know the answers to the following sub-questions:
${newGapQuestions.map((q: string) => `- ${q}`).join('\n')}

You will now figure out the answers to these sub-questions and see if they can help you find the answer to the original question.
`);
        gaps.push(...newGapQuestions.slice(0, 2));
        allQuestions.push(...newGapQuestions.slice(0, 2));
        gaps.push(question.trim());  // always keep the original question in the gaps
      } else {
        diaryContext.push(`
At step ${step}, you took **reflect** and think about the knowledge gaps. You tried to break down the question "${currentQuestion}" into gap-questions like this: ${oldQuestions.join(', ')} 
But then you realized you have asked them before. You decided to to think out of the box or cut from a completely different angle. 
`);
        updateContext({
          totalStep,
          ...thisStep,
          result: 'You have tried all possible questions and found no useful information. You must think out of the box or different angle!!!'
        });

        allowReflect = false;
      }
    } else if (thisStep.action === 'search' && thisStep.searchQuery) {
      // rewrite queries
      let {queries: keywordsQueries} = await rewriteQuery(thisStep, context.tokenTracker);

      const oldKeywords = keywordsQueries;
      // avoid exisitng searched queries
      const {unique_queries: dedupedQueries} = await dedupQueries(keywordsQueries, allKeywords, context.tokenTracker);
      keywordsQueries = dedupedQueries;

      if (keywordsQueries.length > 0) {
        // let googleGrounded = '';
        const searchResults = [];
        context.actionTracker.trackThink(`Let me search for "${keywordsQueries.join(', ')}" to gather more information.`)
        for (const query of keywordsQueries) {
          console.log(`Search query: ${query}`);

          let results;

          switch (SEARCH_PROVIDER) {
            case 'jina':
              // use jinaSearch
              results = {results: (await search(query, context.tokenTracker)).response?.data || []};
              // if (LLM_PROVIDER === 'gemini') {
              //   googleGrounded = await grounding(query, context.tokenTracker);
              // }
              break;
            case 'duck':
              results = await duckSearch(query, {safeSearch: SafeSearchType.STRICT});
              break;
            case 'brave':
              try {
                const {response} = await braveSearch(query);
                results = {
                  results: response.web?.results?.map(r => ({
                    title: r.title,
                    url: r.url,
                    description: r.description
                  })) || []
                };
              } catch (error) {
                console.error('Brave search failed:', error);
                results = {results: []};
              }
              await sleep(STEP_SLEEP)
              break;
            default:
              results = {results: []};
          }
          const minResults = results.results.map(r => ({
            title: r.title,
            url: r.url,
            description: r.description
          }));

          Object.assign(allURLs, Object.fromEntries(
            minResults.map(r => [r.url, r.title])
          ));
          searchResults.push({query, results: minResults});
          allKeywords.push(query);
        }

        allKnowledge.push({
          question: `What do Internet say about ${thisStep.searchQuery}?`,
          answer: removeHTMLtags(searchResults.map(r => r.results.map(r => r.description).join('; ')).join('; ')),
          // answer: googleGrounded + removeHTMLtags(searchResults.map(r => r.results.map(r => r.description).join('; ')).join('; ')),
          type: 'side-info',
          updated: new Date().toISOString()
        });

        diaryContext.push(`
At step ${step}, you took the **search** action and look for external information for the question: "${currentQuestion}".
In particular, you tried to search for the following keywords: "${keywordsQueries.join(', ')}".
You found quite some information and add them to your URL list and **visit** them later when needed. 
`);

        updateContext({
          totalStep,
          question: currentQuestion,
          ...thisStep,
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
          totalStep,
          ...thisStep,
          result: 'You have tried all possible queries and found no new information. You must think out of the box or different angle!!!'
        });

        allowSearch = false;
      }
    } else if (thisStep.action === 'visit' && thisStep.URLTargets?.length) {

      let uniqueURLs = thisStep.URLTargets;
      if (visitedURLs.length > 0) {
        // check duplicate urls
        uniqueURLs = uniqueURLs.filter((url: string) => !visitedURLs.includes(url));
      }

      if (uniqueURLs.length > 0) {
        context.actionTracker.trackThink(`Let me read ${uniqueURLs.join(', ')} to gather more information.`);
        const urlResults = await Promise.all(
          uniqueURLs.map(async (url: string) => {
            try {
              const {response} = await readUrl(url, context.tokenTracker);
              allKnowledge.push({
                question: `What is in ${response.data?.url || 'the URL'}?`,
                answer: removeAllLineBreaks(response.data?.content || 'No content available'),
                references: [response.data?.url],
                type: 'url',
                updated: new Date().toISOString()
              });
              visitedURLs.push(url);
              delete allURLs[url];
              return {url, result: response};
            } catch (error) {
              console.error('Error reading URL:', error);
            }
          })
        );
        diaryContext.push(`
At step ${step}, you took the **visit** action and deep dive into the following URLs:
${urlResults.map(r => r?.url).join('\n')}
You found some useful information on the web and add them to your knowledge for future reference.
`);
        updateContext({
          totalStep,
          question: currentQuestion,
          ...thisStep,
          result: urlResults
        });
      } else {

        diaryContext.push(`
At step ${step}, you took the **visit** action and try to visit the following URLs:
${thisStep.URLTargets.join('\n')}
But then you realized you have already visited these URLs and you already know very well about their contents.

You decided to think out of the box or cut from a completely different angle.`);

        updateContext({
          totalStep,
          ...thisStep,
          result: 'You have visited all possible URLs and found no new information. You must think out of the box or different angle!!!'
        });

        allowRead = false;
      }
    }

    await storeContext(prompt, schema, [allContext, allKeywords, allQuestions, allKnowledge], totalStep);
  }

  await storeContext(prompt, schema, [allContext, allKeywords, allQuestions, allKnowledge], totalStep);
  if (!(thisStep as AnswerAction).isFinal) {
    console.log('Enter Beast mode!!!')
    // any answer is better than no answer, humanity last resort
    step++;
    totalStep++;
    const prompt = getPrompt(
      question,
      diaryContext,
      allQuestions,
      allKeywords,
      false,
      false,
      false,
      false,
      badContext,
      allKnowledge,
      allURLs,
      true
    );

    schema = getSchema(false, false, true, false);
    const generator = new ObjectGeneratorSafe(context.tokenTracker);
    const result = await generator.generateObject({
      model: 'agentBeastMode',
      schema,
      prompt,
    });
    thisStep = result.object as AnswerAction;
    (thisStep as AnswerAction).isFinal = true;
    context.actionTracker.trackAction({totalStep, thisStep, gaps, badAttempts});
  }
  console.log(thisStep)

  await storeContext(prompt, schema, [allContext, allKeywords, allQuestions, allKnowledge], totalStep);
  return {result: thisStep, context};

}

async function storeContext(prompt: string, schema: any, memory: any[][], step: number) {
  try {
    await fs.writeFile(`prompt-${step}.txt`, `
Prompt:
${prompt}

JSONSchema:
${JSON.stringify(zodToJsonSchema(schema), null, 2)}
`);
    const [context, keywords, questions, knowledge] = memory;
    await fs.writeFile('context.json', JSON.stringify(context, null, 2));
    await fs.writeFile('queries.json', JSON.stringify(keywords, null, 2));
    await fs.writeFile('questions.json', JSON.stringify(questions, null, 2));
    await fs.writeFile('knowledge.json', JSON.stringify(knowledge, null, 2));
  } catch (error) {
    console.error('Context storage failed:', error);
  }
}


export async function main() {
  const question = process.argv[2] || "";
  const {
    result: finalStep,
    context: tracker
  } = await getResponse(question) as { result: AnswerAction; context: TrackerContext };
  console.log('Final Answer:', finalStep.answer);

  tracker.tokenTracker.printSummary();
}

if (require.main === module) {
  main().catch(console.error);
}
