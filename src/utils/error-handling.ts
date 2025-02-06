// We use the error name string instead of importing the type since we only need it for instanceof check

export interface GenerateObjectResult<T> {
  object: T;
  totalTokens: number;
}

export async function handleGenerateObjectError<T>(error: unknown, functionName: string): Promise<GenerateObjectResult<T>> {
  if (error instanceof Error && error.name === 'AI_NoObjectGeneratedError') {
    try {
      const partialResponse = JSON.parse((error as any).response);
      return {
        object: partialResponse as T,
        totalTokens: (error as any).usage?.totalTokens || 0
      };
    } catch (parseError) {
      throw error;
    }
  }
  throw error;
}
