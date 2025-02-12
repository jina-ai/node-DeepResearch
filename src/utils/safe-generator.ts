import { z } from 'zod';
import {generateObject, LanguageModelUsage, NoObjectGeneratedError} from "ai";
import {TokenTracker} from "./token-tracker";
import {getModel, ToolName, getToolConfig} from "../config";

interface GenerateObjectResult<T> {
  object: T;
  usage: LanguageModelUsage;
}

interface GenerateOptions<T> {
  model: ToolName;
  schema: z.ZodType<T>;
  prompt: string;
}

export class ObjectGeneratorSafe {
  private tokenTracker: TokenTracker;

  constructor(tokenTracker?: TokenTracker) {
    this.tokenTracker = tokenTracker || new TokenTracker();
  }

  async generateObject<T>(options: GenerateOptions<T>): Promise<GenerateObjectResult<T>> {
    const {
      model,
      schema,
      prompt,
    } = options;

    try {
      // Primary attempt with main model
      const result = await generateObject({
        model: getModel(model),
        schema,
        prompt,
        maxTokens: getToolConfig(model).maxTokens,
        temperature: getToolConfig(model).temperature,
      });

      this.tokenTracker.trackUsage(model, result.usage);
      return result;

    } catch (error) {
      // First fallback: Try manual JSON parsing of the error response
      try {
        const errorResult = await this.handleGenerateObjectError<T>(error);
        this.tokenTracker.trackUsage(model, errorResult.usage);
        return errorResult;

      } catch (parseError) {
        // Second fallback: Try with fallback model if provided
        const fallbackModel = getModel('fallback');
        if (NoObjectGeneratedError.isInstance(parseError)) {
          const failedOutput = (parseError as any).text;
          console.error(`${model} failed on object generation ${failedOutput} -> manual parsing failed again -> trying fallback model`, fallbackModel);
          try {
            const fallbackResult = await generateObject({
              model: fallbackModel,
              schema,
              prompt: `Extract the desired information from this text: \n ${failedOutput}`,
              maxTokens: getToolConfig('fallback').maxTokens,
              temperature: getToolConfig('fallback').temperature,
            });

            this.tokenTracker.trackUsage(model, fallbackResult.usage);
            return fallbackResult;
          } catch (fallbackError) {
            // If fallback model also fails, try parsing its error response
            return await this.handleGenerateObjectError<T>(fallbackError);
          }
        }

        // If no fallback model or all attempts failed, throw the original error
        throw error;
      }
    }
  }

  private async handleGenerateObjectError<T>(error: unknown): Promise<GenerateObjectResult<T>> {
    if (NoObjectGeneratedError.isInstance(error)) {
      console.error('Object not generated according to schema, fallback to manual JSON parsing');
      try {
        const partialResponse = JSON.parse((error as any).text);
        return {
          object: partialResponse as T,
          usage: (error as any).usage
        };
      } catch (parseError) {
        throw error;
      }
    }
    throw error;
  }
}