import { generateText } from 'ai';
import {getModel} from "../config";
import { GoogleGenerativeAIProviderMetadata } from '@ai-sdk/google';
import {TokenTracker} from "../utils/token-tracker";

const model = getModel('searchGrounding')

export async function grounding(query: string, tracker?: TokenTracker): Promise<string> {
  try {
    const { text, experimental_providerMetadata, usage } = await generateText({
      model,
      prompt:
      `Current date is ${new Date().toISOString()}. Find the latest answer to the following question: 
<query>
${query}
</query>      
Must include the date and time of the latest answer.`,
    });

    const metadata = experimental_providerMetadata?.google as
  | GoogleGenerativeAIProviderMetadata
  | undefined;
    const groundingMetadata = metadata?.groundingMetadata;

    // Extract and concatenate all groundingSupport text into a single line
    const groundedText = groundingMetadata?.groundingSupports
      ?.map(support => support.segment.text)
      .join(' ') || '';

    (tracker || new TokenTracker()).trackUsage('grounding', usage);
    console.log('Grounding:', {text, groundedText});
    return text + '|' + groundedText;

  } catch (error) {
    console.error('Error in search:', error);
    throw error;
  }
}