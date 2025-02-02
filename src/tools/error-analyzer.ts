import {GoogleGenerativeAI, SchemaType} from "@google/generative-ai";
import { GEMINI_API_KEY, modelConfigs } from "../config";
import { tokenTracker } from "../utils/token-tracker";

import { ErrorAnalysisResponse } from '../types';

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    recap: {
      type: SchemaType.STRING,
      description: "Recap of the actions taken and the steps conducted"
    },
    blame: {
      type: SchemaType.STRING,
      description: "Which action or the step was the root cause of the answer rejection"
    },
    improvement: {
      type: SchemaType.STRING,
      description: "Suggested key improvement for the next iteration, do not use bullet points, be concise and hot-take vibe."
    }
  },
  required: ["recap", "blame", "improvement"]
};

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: modelConfigs.errorAnalyzer.model,
  generationConfig: {
    temperature: modelConfigs.errorAnalyzer.temperature,
    responseMimeType: "application/json",
    responseSchema: responseSchema
  }
});

function getPrompt(diaryContext: string[]): string {
  return `You are an expert at analyzing search and reasoning processes. Your task is to analyze the given sequence of steps and identify what went wrong in the search process.

Focus on:
1. The sequence of actions taken
2. The effectiveness of each step
3. The logic between consecutive steps
4. Alternative approaches that could have been taken
5. Signs of getting stuck in repetitive patterns
6. Whether the final answer matches the accumulated information

Based on the steps provided, generate a JSON response following this schema.

Example steps to analyze:

At step 1, you took the **search** action and look for external information for the question: "how old is jina ai ceo?".
In particular, you tried to search for the following keywords: "jina ai ceo age".
You found quite some information and add them to your URL list and **visit** them later when needed. 


At step 2, you took the **visit** action and deep dive into the following URLs:
https://www.linkedin.com/in/hxiao87
https://www.crunchbase.com/person/han-xiao
You found some useful information on the web and add them to your knowledge for future reference.


At step 3, you took the **search** action and look for external information for the question: "how old is jina ai ceo?".
In particular, you tried to search for the following keywords: "Han Xiao birthdate, Jina AI founder birthdate".
You found quite some information and add them to your URL list and **visit** them later when needed. 


At step 4, you took the **search** action and look for external information for the question: "how old is jina ai ceo?".
In particular, you tried to search for the following keywords: han xiao birthday. 
But then you realized you have already searched for these keywords before.
You decided to think out of the box or cut from a completely different angle.


At step 5, you took the **search** action and look for external information for the question: "how old is jina ai ceo?".
In particular, you tried to search for the following keywords: han xiao birthday. 
But then you realized you have already searched for these keywords before.
You decided to think out of the box or cut from a completely different angle.


At step 6, you took the **visit** action and deep dive into the following URLs:
https://kpopwall.com/han-xiao/
https://www.idolbirthdays.net/han-xiao
You found some useful information on the web and add them to your knowledge for future reference.


At step 7, you took **answer** action but evaluator thinks it is not a good answer:

Original question: 
how old is jina ai ceo?

Your answer: 
The age of the Jina AI CEO cannot be definitively determined from the provided information.

The evaluator thinks your answer is bad because: 
The answer is not definitive and fails to provide the requested information.  Lack of information is unacceptable, more search and deep reasoning is needed.

Analyze the steps and provide detailed feedback following these guidelines:
- In the recap: Summarize key actions chronologically, highlight patterns, and identify where the process started to go wrong
- In the blame: Point to specific steps or patterns that led to the inadequate answer
- In the improvement: Provide actionable suggestions that could have led to a better outcome

Example analysis output:
{
  "recap": "The search process consisted of 7 steps with multiple search and visit actions. The initial searches focused on basic biographical information through LinkedIn and Crunchbase (steps 1-2). When this didn't yield the specific age information, additional searches were conducted for birthdate information (steps 3-5). The process showed signs of repetition in steps 4-5 with identical searches. Final visits to entertainment websites (step 6) suggested a loss of focus on reliable business sources.",
  
  "blame": "The root cause of failure was getting stuck in a repetitive search pattern without adapting the strategy. Steps 4-5 repeated the same search, and step 6 deviated to less reliable entertainment sources instead of exploring business journals, news articles, or professional databases. Additionally, the process didn't attempt to triangulate age through indirect information like education history or career milestones.",
  
  "improvement": "1. Avoid repeating identical searches and implement a strategy to track previously searched terms. 2. When direct age/birthdate searches fail, try indirect approaches like: searching for earliest career mentions, finding university graduation years, or identifying first company founding dates. 3. Focus on high-quality business sources and avoid entertainment websites for professional information. 4. Consider using industry event appearances or conference presentations where age-related context might be mentioned. 5. If exact age cannot be determined, provide an estimated range based on career timeline and professional achievements."
}

Review the steps below carefully and generate your analysis following this format.

${diaryContext.join('\n')}
`;
}

export async function analyzeSteps(diaryContext: string[]): Promise<{ response: ErrorAnalysisResponse, tokens: number }> {
  try {
    const prompt = getPrompt(diaryContext);
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const usage = response.usageMetadata;
    const json = JSON.parse(response.text()) as ErrorAnalysisResponse;
    console.log('Error analysis:', {
      is_valid: !json.blame,
      reason: json.blame || 'No issues found'
    });
    const tokens = usage?.totalTokenCount || 0;
    tokenTracker.trackUsage('error-analyzer', tokens);
    return { response: json, tokens };
  } catch (error) {
    console.error('Error in answer evaluation:', error);
    throw error;
  }
}
