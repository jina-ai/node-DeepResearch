import { SchemaType } from "@google/generative-ai";

// Action Types
type BaseAction = {
  action: "search" | "answer" | "reflect" | "visit";
  thoughts: string;
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
  }>;
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
  thought: string;
  unique_queries: string[];
};

export interface ReadResponse {
  code: number;
  status: number;
  data: {
    title: string;
    description: string;
    url: string;
    content: string;
    usage: { tokens: number; };
  };
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
  thought: string;
  queries: string[];
};

// Schema Types
export type SchemaProperty = {
  type: SchemaType;
  description: string;
  enum?: string[];
  items?: {
    type: SchemaType;
    description?: string;
    properties?: Record<string, SchemaProperty>;
    required?: string[];
  };
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  maxItems?: number;
};

export type ResponseSchema = {
  type: SchemaType;
  properties: Record<string, SchemaProperty>;
  required: string[];
};
