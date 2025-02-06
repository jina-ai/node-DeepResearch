import dotenv from 'dotenv';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';

export type LLMProvider = 'openai' | 'gemini';
export type ToolName = keyof ToolConfigs;

function isValidProvider(provider: string): provider is LLMProvider {
  return provider === 'openai' || provider === 'gemini';
}

function validateModelConfig(config: ModelConfig, toolName: string): ModelConfig {
  if (typeof config.model !== 'string' || config.model.length === 0) {
    throw new Error(`Invalid model name for ${toolName}`);
  }
  if (typeof config.temperature !== 'number' || config.temperature < 0 || config.temperature > 1) {
    throw new Error(`Invalid temperature for ${toolName}`);
  }
  if (typeof config.maxTokens !== 'number' || config.maxTokens <= 0) {
    throw new Error(`Invalid maxTokens for ${toolName}`);
  }
  return config;
}

export interface ModelConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface ToolConfigs {
  dedup: ModelConfig;
  evaluator: ModelConfig;
  errorAnalyzer: ModelConfig;
  queryRewriter: ModelConfig;
  agent: ModelConfig;
  agentBeastMode: ModelConfig;
}


dotenv.config();

// Setup the proxy globally if present
if (process.env.https_proxy) {
  try {
    const proxyUrl = new URL(process.env.https_proxy).toString();
    const dispatcher = new ProxyAgent({ uri: proxyUrl });
    setGlobalDispatcher(dispatcher);
  } catch (error) {
    console.error('Failed to set proxy:', error);
  }
}

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY as string;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string;
export const JINA_API_KEY = process.env.JINA_API_KEY as string;
export const BRAVE_API_KEY = process.env.BRAVE_API_KEY as string;
export const SEARCH_PROVIDER: 'brave' | 'jina' | 'duck' = 'jina';
export const LLM_PROVIDER: LLMProvider = (() => {
  const provider = process.env.LLM_PROVIDER || 'gemini';
  if (!isValidProvider(provider)) {
    throw new Error(`Invalid LLM provider: ${provider}`);
  }
  return provider;
})();

const DEFAULT_GEMINI_MODEL = 'gemini-1.5-flash';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

const defaultGeminiConfig: ModelConfig = {
  model: DEFAULT_GEMINI_MODEL,
  temperature: 0,
  maxTokens: 1000
};

const defaultOpenAIConfig: ModelConfig = {
  model: DEFAULT_OPENAI_MODEL,
  temperature: 0,
  maxTokens: 1000
};

export const modelConfigs: Record<LLMProvider, ToolConfigs> = {
  gemini: {
    dedup: validateModelConfig({ ...defaultGeminiConfig, temperature: 0.1 }, 'dedup'),
    evaluator: validateModelConfig({ ...defaultGeminiConfig }, 'evaluator'),
    errorAnalyzer: validateModelConfig({ ...defaultGeminiConfig }, 'errorAnalyzer'),
    queryRewriter: validateModelConfig({ ...defaultGeminiConfig, temperature: 0.1 }, 'queryRewriter'),
    agent: validateModelConfig({ ...defaultGeminiConfig, temperature: 0.7 }, 'agent'),
    agentBeastMode: validateModelConfig({ ...defaultGeminiConfig, temperature: 0.7 }, 'agentBeastMode')
  },
  openai: {
    dedup: validateModelConfig({ ...defaultOpenAIConfig, temperature: 0.1 }, 'dedup'),
    evaluator: validateModelConfig({ ...defaultOpenAIConfig }, 'evaluator'),
    errorAnalyzer: validateModelConfig({ ...defaultOpenAIConfig }, 'errorAnalyzer'),
    queryRewriter: validateModelConfig({ ...defaultOpenAIConfig, temperature: 0.1 }, 'queryRewriter'),
    agent: validateModelConfig({ ...defaultOpenAIConfig, temperature: 0.7 }, 'agent'),
    agentBeastMode: validateModelConfig({ ...defaultOpenAIConfig, temperature: 0.7 }, 'agentBeastMode')
  }
};

export function getToolConfig(toolName: ToolName): ModelConfig {
  if (!modelConfigs[LLM_PROVIDER][toolName]) {
    throw new Error(`Invalid tool name: ${toolName}`);
  }
  return modelConfigs[LLM_PROVIDER][toolName];
}

export function getMaxTokens(toolName: ToolName): number {
  return getToolConfig(toolName).maxTokens;
}


export function getModel(toolName: ToolName) {
  const config = getToolConfig(toolName);

  if (LLM_PROVIDER === 'openai') {
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not found');
    }
    return createOpenAI({
      apiKey: OPENAI_API_KEY,
      compatibility: 'strict'
    })(config.model);
  }

  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not found');
  }
  return createGoogleGenerativeAI({ apiKey: GEMINI_API_KEY })(config.model);
}

export const STEP_SLEEP = 1000;

if (LLM_PROVIDER === 'gemini' && !GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not found");
if (LLM_PROVIDER === 'openai' && !OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not found");
if (!JINA_API_KEY) throw new Error("JINA_API_KEY not found");

console.log('LLM Provider:', LLM_PROVIDER)