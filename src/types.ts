// Action Types
import { CoreMessage, LanguageModelUsage } from "ai";

type BaseAction = {
  action: "search" | "answer" | "reflect" | "visit" | "coding";
  think: string;
};

export type SERPQuery = {
  q: string,
  location?: string,
  tbs?: string,
}

export type SearchAction = BaseAction & {
  action: "search";
  searchRequests: string[];
};

export type Reference = {
  exactQuote: string;
  url: string;
  title: string;
  dateTime?: string;
  relevanceScore?: number;
  answerChunk?: string;
  answerChunkPosition?: number[];
}

export type AnswerAction = BaseAction & {
  action: "answer";
  answer: string;
  references: Array<Reference>;
  isFinal?: boolean;
  mdAnswer?: string;
};


export type KnowledgeItem = {
  question: string,
  answer: string,
  references?: Array<Reference> | Array<any>;
  type: 'qa' | 'side-info' | 'chat-history' | 'url' | 'coding',
  updated?: string,
  sourceCode?: string,
}

export type ReflectAction = BaseAction & {
  action: "reflect";
  questionsToAnswer: string[];
};

export type VisitAction = BaseAction & {
  action: "visit";
  URLTargets: number[] | string[];
};

export type CodingAction = BaseAction & {
  action: "coding";
  codingIssue: string;
};

export type StepAction = SearchAction | AnswerAction | ReflectAction | VisitAction | CodingAction;

export type EvaluationType = 'definitive' | 'freshness' | 'plurality' | 'attribution' | 'completeness' | 'strict';

export type RepeatEvaluationType = {
  type: EvaluationType;
  numEvalsRequired: number;
}

// Following Vercel AI SDK's token counting interface
export interface TokenUsage {
  tool: string;
  usage: LanguageModelUsage;
}

export interface ArxivSearchResponse {
  results: Array<{
    title: string;
    snippet: string;
    url: string;
  }>;
  meta: {
    query: string;
    num_results: number;
    latency: number;
    credits: number;
  }
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

export interface SerperSearchResponse {
  knowledgeGraph?: {
    title: string;
    type: string;
    website: string;
    imageUrl: string;
    description: string;
    descriptionSource: string;
    descriptionLink: string;
    attributes: { [k: string]: string; };
  },
  organic: {
    title: string;
    link: string;
    snippet: string;
    date: string;
    siteLinks?: { title: string; link: string; }[];
    position: number,
  }[];
  topStories?: {
    title: string;
    link: string;
    source: string;
    data: string;
    imageUrl: string;
  }[];
  relatedSearches?: string[];
  credits: number;
}


export interface ReadResponse {
  code: number;
  status: number;
  data?: {
    title: string;
    description: string;
    url: string;
    content: string;
    usage: { tokens: number; };
    links: Array<[string, string]>; // [anchor, url]
  };
  name?: string;
  message?: string;
  readableMessage?: string;
}


export type EvaluationResponse = {
  pass: boolean;
  think: string;
  type?: EvaluationType;
  freshness_analysis?: {
    days_ago: number;
    max_age_days?: number;
  };
  plurality_analysis?: {
    minimum_count_required: number;
    actual_count_provided: number;
  };
  exactQuote?: string;
  completeness_analysis?: {
    aspects_expected: string,
    aspects_provided: string,
  },
  improvement_plan?: string;
};

export type CodeGenResponse = {
  think: string;
  code: string;
}

export type ErrorAnalysisResponse = {
  recap: string;
  blame: string;
  improvement: string;
};


export type UnNormalizedSearchSnippet = {
  title: string;
  url?: string;
  description?: string;
  link?: string;
  snippet?: string;
  weight?: number,
  date?: string
};

export type SearchSnippet = UnNormalizedSearchSnippet & {
  url: string;
  description: string;
};

export type WebContent = {
  full?: string,
  chunks: string[]
  chunk_positions: number[][],
  title: string
}

export type BoostedSearchSnippet = SearchSnippet & {
  freqBoost: number;
  hostnameBoost: number;
  pathBoost: number;
  jinaRerankBoost: number;
  finalScore: number;
}

// OpenAI API Types
export interface Model {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export type PromptPair = { system: string, user: string };

export type ResponseFormat = {
  type: 'json_schema' | 'json_object';
  json_schema?: any;
}

export interface ChatCompletionRequest {
  model: string;
  messages: Array<CoreMessage>;
  stream?: boolean;
  reasoning_effort?: 'low' | 'medium' | 'high';
  max_completion_tokens?: number;

  budget_tokens?: number;
  max_attempts?: number;

  response_format?: ResponseFormat;
  no_direct_answer?: boolean;
  max_returned_urls?: number;

  boost_hostnames?: string[];
  bad_hostnames?: string[];
  only_hostnames?: string[];

  max_annotations?: number;
  min_annotation_relevance?: number;
  language_code?: string;
}

export interface URLAnnotation {
  type: 'url_citation',
  url_citation: Reference
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
      type: 'text' | 'think' | 'json' | 'error';
      annotations?: Array<URLAnnotation>;
    };
    logprobs: null;
    finish_reason: 'stop' | 'error';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  visitedURLs?: string[];
  readURLs?: string[];
  numURLs?: number;
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
      type?: 'text' | 'think' | 'json' | 'error';
      url?: string;
      annotations?: Array<URLAnnotation>;
    };
    logprobs: null;
    finish_reason: null | 'stop' | 'thinking_end' | 'error';
  }>;
  usage?: any;
  visitedURLs?: string[];
  readURLs?: string[];
  numURLs?: number;
}

// Tracker Types
import { TokenTracker } from './utils/token-tracker';
import { ActionTracker } from './utils/action-tracker';

export interface TrackerContext {
  tokenTracker: TokenTracker;
  actionTracker: ActionTracker;
}





// Interface definitions for Jina API
export interface JinaEmbeddingRequest {
  model: string;
  task: string;
  late_chunking?: boolean;
  dimensions?: number;
  embedding_type?: string;
  input: string[];
  truncate?: boolean;
}

export interface JinaEmbeddingResponse {
  model: string;
  object: string;
  usage: {
    total_tokens: number;
    prompt_tokens: number;
  };
  data: Array<{
    object: string;
    index: number;
    embedding: number[];
  }>;
}