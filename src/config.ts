import dotenv from 'dotenv';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

export type LLMProvider = 'openai' | 'gemini';

interface ModelConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

interface ToolConfigs {
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
export const LLM_PROVIDER: LLMProvider = (process.env.LLM_PROVIDER as LLMProvider) || 'gemini';

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
    dedup: { ...defaultGeminiConfig, temperature: 0.1 },
    evaluator: { ...defaultGeminiConfig },
    errorAnalyzer: { ...defaultGeminiConfig },
    queryRewriter: { ...defaultGeminiConfig, temperature: 0.1 },
    agent: { ...defaultGeminiConfig, temperature: 0.7 },
    agentBeastMode: { ...defaultGeminiConfig, temperature: 0.7 }
  },
  openai: {
    dedup: { ...defaultOpenAIConfig, temperature: 0.1 },
    evaluator: { ...defaultOpenAIConfig },
    errorAnalyzer: { ...defaultOpenAIConfig },
    queryRewriter: { ...defaultOpenAIConfig, temperature: 0.1 },
    agent: { ...defaultOpenAIConfig, temperature: 0.7 },
    agentBeastMode: { ...defaultOpenAIConfig, temperature: 0.7 }
  }
};

export const STEP_SLEEP = 1000;

if (LLM_PROVIDER === 'gemini' && !GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not found");
if (LLM_PROVIDER === 'openai' && !OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not found");
if (!JINA_API_KEY) throw new Error("JINA_API_KEY not found");
