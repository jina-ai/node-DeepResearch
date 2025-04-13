import axios from 'axios';
import { TokenTracker } from "../utils/token-tracker";
import { JINA_API_KEY } from "../config";
import {TrackerContext} from "../types";

export async function segmentText(
  content: string,
  tracker: TrackerContext,
  maxChunkLength = 1000,
  returnChunks = true,
) {
  if (!content.trim()) {
    throw new Error('Content cannot be empty');
  }

  try {
    const { data } = await axios.post(
      'https://api.jina.ai/v1/segment',
      {
        content,
        return_chunks: returnChunks,
        max_chunk_length: maxChunkLength
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${JINA_API_KEY}`,
        },
        timeout: 10000,
        responseType: 'json'
      }
    );

    if (!data) {
      throw new Error('Invalid response data');
    }

    console.log('Segment:', {
      numChunks: data.num_chunks,
      numTokens: data.num_tokens,
      tokenizer: data.tokenizer
    });

    const tokens = data.usage?.tokens || 0;
    const tokenTracker = tracker?.tokenTracker || new TokenTracker();
    tokenTracker.trackUsage('segment', {
      totalTokens: tokens,
      promptTokens: content.length,
      completionTokens: tokens
    });

    // Return only chunks and chunk_positions
    return {
      chunks: data.chunks,
      chunk_positions: data.chunk_positions
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        const status = error.response.status;
        const errorData = error.response.data;

        if (status === 402) {
          throw new Error(errorData?.readableMessage || 'Insufficient balance');
        }
        throw new Error(errorData?.readableMessage || `HTTP Error ${status}`);
      } else if (error.request) {
        throw new Error('No response received from server');
      } else {
        throw new Error(`Request failed: ${error.message}`);
      }
    }
    throw error;
  }
}