import { TokenTracker } from "../utils/token-tracker";
import { ReadResponse } from '../types';
import { JINA_API_KEY } from "../config";
import axiosClient from "../utils/axios-client";

export async function readUrl(
  url: string,
  withAllLinks?: boolean,
  tracker?: TokenTracker,
  withAllImages?: boolean
): Promise<{ response: ReadResponse }> {
  if (!url.trim()) {
    throw new Error('URL cannot be empty');
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('Invalid URL, only http and https URLs are supported');
  }

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Authorization': `Bearer ${JINA_API_KEY}`,
    'Content-Type': 'application/json',
    'X-Md-Link-Style': 'discarded',
  };

  if (withAllLinks) {
    headers['X-With-Links-Summary'] = 'all';
  }

  if (withAllImages) {
    headers['X-With-Images-Summary'] = 'true'
  } else {
    headers['X-Retain-Images'] = 'none'
  }

  try {
    // Use axios which handles encoding properly
    const { data } = await axiosClient.post<ReadResponse>(
      'https://r.jina.ai/',
      { url },
      {
        headers,
        timeout: 60000,
        responseType: 'json'
      }
    );

    if (!data.data) {
      throw new Error('Invalid response data');
    }

    console.log('Read:', {
      title: data.data.title,
      url: data.data.url,
      tokens: data.data.usage?.tokens || 0
    });

    const tokens = data.data.usage?.tokens || 0;
    const tokenTracker = tracker || new TokenTracker();
    tokenTracker.trackUsage('read', {
      totalTokens: tokens,
      promptTokens: url.length,
      completionTokens: tokens
    });

    return { response: data };
  } catch (error: any) {
    console.error(`Error reading URL: ${error.message}`);
    throw error;
  }
}