import { NoObjectGeneratedError } from 'ai';

export interface GenerateObjectResult<T> {
  object: T;
  totalTokens: number;
}

export async function handleGenerateObjectError<T>(error: unknown, functionName: string): Promise<GenerateObjectResult<T>> {
  if (error instanceof Error && error.name === 'AI_NoObjectGeneratedError') {
    console.warn(`Schema validation error in ${functionName}, attempting to parse response:`, error);
    try {
      const partialResponse = JSON.parse((error as any).response);
      return {
        object: partialResponse as T,
        totalTokens: (error as any).usage?.totalTokens || 0
      };
    } catch (parseError) {
      console.error(`Failed to parse partial response in ${functionName}:`, parseError);
      throw error;
    }
  }
  throw error;
}
