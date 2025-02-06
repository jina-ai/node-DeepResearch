import { z } from 'zod';

export const ThinkSchema = z.string().describe('Strategic reasoning about the process');

export const QuerySchema = z.string()
  .max(30)
  .describe('Search query, must be less than 30 characters');

export const URLSchema = z.string().url();

export const ReferenceSchema = z.object({
  exactQuote: z.string().describe('Exact relevant quote from the document'),
  url: URLSchema.describe('URL of the document')
});

// Action Types
type BaseAction = {
  action: "search" | "answer" | "reflect" | "visit";
  think: string;
};

export type SearchAction = BaseAction & {
  action: "search";
  searchQuery: string;
};

export type AnswerAction = BaseAction & {
  action: "answer";
  answer: string;
  references: Array<{
    exactQuote: string;
    url: string;
  }>;
};

export type ReflectAction = BaseAction & {
  action: "reflect";
  questionsToAnswer: string[];
};

export type VisitAction = BaseAction & {
  action: "visit";
  URLTargets: string[];
};

export type StepAction = SearchAction | AnswerAction | ReflectAction | VisitAction;

// Response Types
export interface TokenUsage {
  tool: string;
  tokens: number;
}

export interface SearchResponse {
  code: number;
  status: number;
  data: Array<{
    title: string;
    description: string;
    url: string;
    content: string;
    usage: { tokens: number; };
  }> | null;
  name?: string;
  message?: string;
  readableMessage?: string;
}

export interface BraveSearchResponse {
  web: {
    results: Array<{
      title: string;
      description: string;
      url: string;
    }>;
  };
}

export type DedupResponse = {
  think: string;
  unique_queries: string[];
};

export interface ReadResponse {
  code: number;
  status: number;
  data?: {
    title: string;
    description: string;
    url: string;
    content: string;
    usage: { tokens: number; };
  };
  name?: string;
  message?: string;
  readableMessage?: string;
}

export type EvaluationResponse = {
  is_definitive: boolean;
  reasoning: string;
};

export type ErrorAnalysisResponse = {
  recap: string;
  blame: string;
  improvement: string;
};

export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export interface QueryResult {
  query: string;
  results: SearchResult[];
}

export interface StepData {
  step: number;
  question: string;
  action: string;
  reasoning: string;
  searchQuery?: string;
  result?: QueryResult[];
}

export type KeywordsResponse = {
  think: string;
  queries: string[];
};

export interface StreamMessage {
  type: 'progress' | 'answer' | 'error';
  data: string | StepAction;
  step?: number;
  budget?: {
    used: number;
    total: number;
    percentage: string;
  };
}

// Tracker Types
import { TokenTracker } from './utils/token-tracker';
import { ActionTracker } from './utils/action-tracker';

export interface TrackerContext {
  tokenTracker: TokenTracker;
  actionTracker: ActionTracker;
}
