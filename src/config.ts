import dotenv from 'dotenv';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

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
export const SEARCH_PROVIDER = BRAVE_API_KEY ? 'brave' : 'duck';

export const MODEL_NAME = 'gemini-1.5-flash';

if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not found");
if (!JINA_API_KEY) throw new Error("JINA_API_KEY not found");
