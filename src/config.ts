import dotenv from 'dotenv';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI, OpenAIProviderSettings } from '@ai-sdk/openai';
import { createAzure, AzureOpenAIProviderSettings } from '@ai-sdk/azure'
import configJson from '../config.json';
// Load environment variables
dotenv.config();

// Types
export type LLMProvider = 'openai' | 'gemini' | 'vertex' | 'azure';
export type ToolName = keyof typeof configJson.models.gemini.tools;

// Type definitions for our config structure
type EnvConfig = typeof configJson.env;

interface ProviderConfig {
  createClient: string;
  clientConfig?: Record<string, any>;
}

// Environment setup
const env: EnvConfig = { ...configJson.env };
(Object.keys(env) as (keyof EnvConfig)[]).forEach(key => {
  if (process.env[key]) {
    env[key] = process.env[key] || env[key];
  }
});

// Setup proxy if present
if (env.https_proxy) {
  try {
    const proxyUrl = new URL(env.https_proxy).toString();
    const dispatcher = new ProxyAgent({ uri: proxyUrl });
    setGlobalDispatcher(dispatcher);
  } catch (error) {
    console.error('Failed to set proxy:', error);
  }
}

// Export environment variables
export const OPENAI_BASE_URL = env.OPENAI_BASE_URL;
export const GEMINI_API_KEY = env.GEMINI_API_KEY;
export const OPENAI_API_KEY = env.OPENAI_API_KEY;
export const JINA_API_KEY = env.JINA_API_KEY;
export const BRAVE_API_KEY = env.BRAVE_API_KEY;
export const SERPER_API_KEY = env.SERPER_API_KEY;
export const SEARCH_PROVIDER = configJson.defaults.search_provider;
export const STEP_SLEEP = configJson.defaults.step_sleep;
export const AZURE_OPENAI_RESOURCE_NAME = env.AZURE_OPENAI_RESOURCE_NAME;
export const AZURE_OPENAI_API_KEY = env.AZURE_OPENAI_API_KEY;
export const AZURE_OPENAI_API_VERSION = env.AZURE_OPENAI_API_VERSION;

// Determine LLM provider
export const LLM_PROVIDER: LLMProvider = (() => {
  const provider = process.env.LLM_PROVIDER || configJson.defaults.llm_provider;
  if (!isValidProvider(provider)) {
    throw new Error(`Invalid LLM provider: ${provider}`);
  }
  return provider;
})();

function isValidProvider(provider: string): provider is LLMProvider {
  return provider === 'openai' || provider === 'gemini' || provider === 'vertex' || provider === 'azure';
}

interface ToolConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

interface ToolOverrides {
  temperature?: number;
  maxTokens?: number;
}

// Get tool configuration
export function getToolConfig(toolName: ToolName): ToolConfig {
  const providerConfig = configJson.models[LLM_PROVIDER === 'vertex' ? 'gemini' : LLM_PROVIDER];
  const defaultConfig = providerConfig.default;
  const toolOverrides = providerConfig.tools[toolName] as ToolOverrides;

  return {
    model: process.env.DEFAULT_MODEL_NAME || defaultConfig.model,
    temperature: toolOverrides.temperature ?? defaultConfig.temperature,
    maxTokens: toolOverrides.maxTokens ?? defaultConfig.maxTokens
  };
}

export function getMaxTokens(toolName: ToolName): number {
  return getToolConfig(toolName).maxTokens;
}

// Get model instance
export function getModel(toolName: ToolName) {
  const config = getToolConfig(toolName);
  const providerConfig = (configJson.providers as Record<string, ProviderConfig | undefined>)[LLM_PROVIDER];
  if (LLM_PROVIDER === 'azure') {
    if (!AZURE_OPENAI_API_KEY) {
      throw new Error('AZURE_OPENAI_API_KEY not found');
    }

    if (!AZURE_OPENAI_RESOURCE_NAME) {
      throw new Error('AZURE_OPENAI_RESOURCE_NAME not found');
    }

    if (!AZURE_OPENAI_API_VERSION) {
      throw new Error('AZURE_OPENAI_API_VERSION not found');
    }

    const opt: AzureOpenAIProviderSettings = {
      apiKey: AZURE_OPENAI_API_KEY,
      resourceName: AZURE_OPENAI_RESOURCE_NAME,
      apiVersion: AZURE_OPENAI_API_VERSION
    };

    return createAzure(opt)(config.model);
  }

  if (LLM_PROVIDER === 'openai') {
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not found');
    }

    const opt: OpenAIProviderSettings = {
      apiKey: OPENAI_API_KEY,
      compatibility: providerConfig?.clientConfig?.compatibility
    };

    if (OPENAI_BASE_URL) {
      opt.baseURL = OPENAI_BASE_URL;
    }

    return createOpenAI(opt)(config.model);
  }

  if (LLM_PROVIDER === 'vertex') {
    const createVertex = require('@ai-sdk/google-vertex').createVertex;
    if (toolName === 'searchGrounding') {
      return createVertex({ project: process.env.GCLOUD_PROJECT, ...providerConfig?.clientConfig })(config.model, { useSearchGrounding: true });
    }
    return createVertex({ project: process.env.GCLOUD_PROJECT, ...providerConfig?.clientConfig })(config.model);
  }

  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not found');
  }

  if (toolName === 'searchGrounding') {
    return createGoogleGenerativeAI({ apiKey: GEMINI_API_KEY })(config.model, { useSearchGrounding: true });
  }
  return createGoogleGenerativeAI({ apiKey: GEMINI_API_KEY })(config.model);
}

// Validate required environment variables
if (LLM_PROVIDER === 'gemini' && !GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not found");
if (LLM_PROVIDER === 'openai' && !OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not found");
if (LLM_PROVIDER === 'azure' && !AZURE_OPENAI_API_KEY) throw new Error("AZURE_OPENAI_API_KEY not found");
if (LLM_PROVIDER === 'azure' && !AZURE_OPENAI_RESOURCE_NAME) throw new Error("AZURE_OPENAI_RESOURCE_NAME not found");
if (LLM_PROVIDER === 'azure' && !AZURE_OPENAI_API_VERSION) throw new Error("AZURE_OPENAI_API_VERSION not found");
if (!JINA_API_KEY) throw new Error("JINA_API_KEY not found");

const providerModels: Record<LLMProvider, string> = {
  openai : configJson.models.openai.default.model,
  gemini : configJson.models.gemini.default.model,
  vertex : configJson.models.gemini.default.model,   // vertex uses Gemini models
  azure  : configJson.models.azure.default.model,
};

const providerExtras: Record<LLMProvider, Record<string, unknown>> = {
  openai : { baseUrl: OPENAI_BASE_URL },
  azure  : { resourceName: AZURE_OPENAI_RESOURCE_NAME, apiVersion: AZURE_OPENAI_API_VERSION },
  gemini : {},
  vertex : {},
};

const providerNameForTools: Record<LLMProvider, keyof typeof configJson.models> = {
  openai : 'openai',
  gemini : 'gemini',
  vertex : 'gemini',   // vertex shares the Gemini tool settings
  azure  : 'azure',
};

const configSummary = {
  provider: {
    name : LLM_PROVIDER,
    model: providerModels[LLM_PROVIDER],
    ...providerExtras[LLM_PROVIDER],       // adds baseUrl / endpoint when present
  },

  search: { provider: SEARCH_PROVIDER },

  tools: Object.fromEntries(
    Object.keys(
      configJson.models[providerNameForTools[LLM_PROVIDER]].tools
    ).map(name => [
      name,
      getToolConfig(name as ToolName),
    ]),
  ),

  defaults: { stepSleep: STEP_SLEEP },
};

console.log(
  'Configuration Summary:',
  JSON.stringify(configSummary, null, 2),
);
