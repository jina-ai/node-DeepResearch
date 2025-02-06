import dotenv from 'dotenv';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

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
export const JINA_API_KEY = process.env.JINA_API_KEY as string;
export const BRAVE_API_KEY = process.env.BRAVE_API_KEY as string;
export const SEARCH_PROVIDER: 'brave' | 'jina' | 'duck' = 'jina'

const DEFAULT_MODEL = 'gemini-1.5-flash';

const defaultConfig: ModelConfig = {
  model: DEFAULT_MODEL,
  temperature: 0,
  maxTokens: 1000
};

export const modelConfigs: ToolConfigs = {
  dedup: {
    ...defaultConfig,
    temperature: 0.1
  },
  evaluator: {
    ...defaultConfig
  },
  errorAnalyzer: {
    ...defaultConfig
  },
  queryRewriter: {
    ...defaultConfig,
    temperature: 0.1
  },
  agent: {
    ...defaultConfig,
    temperature: 0.7
  },
  agentBeastMode: {
    ...defaultConfig,
    temperature: 0.7
  }
};

export const STEP_SLEEP = 1000;

if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not found");
if (!JINA_API_KEY) throw new Error("JINA_API_KEY not found");
