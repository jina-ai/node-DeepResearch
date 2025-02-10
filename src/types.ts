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
export const TOKEN_CATEGORIES = {
  PROMPT: 'prompt',
  REASONING: 'reasoning',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected'
} as const;

export type TokenCategory = typeof TOKEN_CATEGORIES[keyof typeof TOKEN_CATEGORIES];

// Following Vercel AI SDK's token counting interface
export interface TokenUsage {
  tool: string;
  tokens: number;
  category?: TokenCategory;
  // Following Vercel AI SDK's token counting interface
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
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
  pass: boolean;
  think: string;
  type?: 'definitive' | 'freshness' | 'plurality';
  freshness_analysis?: {
    likely_outdated: boolean;
    dates_mentioned: string[];
    current_time: string;
    max_age_days?: number;
  };
  plurality_analysis?: {
    expects_multiple: boolean;
    provides_multiple: boolean;
    count_expected?: number;
    count_provided: number;
  };
};

export type ErrorAnalysisResponse = {
  recap: string;
  blame: string;
  improvement: string;
  questionsToAnswer: string[];
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

// OpenAI API Types
export interface Model {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
  stream?: boolean;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  system_fingerprint: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    logprobs: null;
    finish_reason: 'stop';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details?: {
      reasoning_tokens: number;
      accepted_prediction_tokens: number;
      rejected_prediction_tokens: number;
    };
  };
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  system_fingerprint: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
    };
    logprobs: null;
    finish_reason: null | 'stop';
  }>;
}

// Tracker Types
import {TokenTracker} from './utils/token-tracker';
import {ActionTracker} from './utils/action-tracker';

export interface TrackerContext {
  tokenTracker: TokenTracker;
  actionTracker: ActionTracker;
}
