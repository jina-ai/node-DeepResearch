import {z} from 'zod';
import {
  CoreMessage,
  generateObject,
  LanguageModelUsage,
  NoObjectGeneratedError,
  Schema
} from "ai";
import {TokenTracker} from "./token-tracker";
import {getModel, ToolName, getToolConfig} from "../config";
import Hjson from 'hjson'; // Import Hjson library

interface GenerateObjectResult<T> {
  object: T;
  usage: LanguageModelUsage;
}

interface GenerateOptions<T> {
  model: ToolName;
  schema: z.ZodType<T> | Schema<T>;
  prompt?: string;
  system?: string;
  messages?: CoreMessage[];
  numRetries?: number;
}

export class ObjectGeneratorSafe {
  private tokenTracker: TokenTracker;

  constructor(tokenTracker?: TokenTracker) {
    this.tokenTracker = tokenTracker || new TokenTracker();
  }

  /**
   * Creates a distilled version of a schema by removing all descriptions
   * This makes the schema simpler for fallback parsing scenarios
   */
  private createDistilledSchema<T>(schema: z.ZodType<T> | Schema<T>): z.ZodType<T> | Schema<T> {
    // For zod schemas
    if (schema instanceof z.ZodType) {
      return this.stripZodDescriptions(schema);
    }

    // For AI SDK Schema objects
    if (typeof schema === 'object' && schema !== null) {
      return this.stripSchemaDescriptions(schema as Schema<T>);
    }

    // If we can't determine the schema type, return as is
    return schema;
  }

  /**
   * Recursively strips descriptions from Zod schemas
   */
  private stripZodDescriptions<T>(zodSchema: z.ZodType<T>): z.ZodType<T> {
    if (zodSchema instanceof z.ZodObject) {
      const shape = zodSchema._def.shape();
      const newShape: Record<string, any> = {};

      for (const key in shape) {
        if (Object.prototype.hasOwnProperty.call(shape, key)) {
          // Recursively strip descriptions from nested schemas
          newShape[key] = this.stripZodDescriptions(shape[key]);
        }
      }

      return z.object(newShape) as unknown as z.ZodType<T>;
    }

    if (zodSchema instanceof z.ZodArray) {
      return z.array(this.stripZodDescriptions(zodSchema._def.type)) as unknown as z.ZodType<T>;
    }

    if (zodSchema instanceof z.ZodString) {
      // Create a new string schema without any describe() metadata
      return z.string() as unknown as z.ZodType<T>;
    }

    if (zodSchema instanceof z.ZodUnion || zodSchema instanceof z.ZodIntersection) {
      // These are more complex schemas that would need special handling
      // This is a simplified implementation
      return zodSchema;
    }

    // For other primitive types or complex types we're not handling specifically,
    // return as is
    return zodSchema;
  }

  /**
   * Strips descriptions from AI SDK Schema objects
   */
  private stripSchemaDescriptions<T>(schema: Schema<T>): Schema<T> {
    // Deep clone the schema to avoid modifying the original
    const clonedSchema = JSON.parse(JSON.stringify(schema));

    // Recursively remove description properties
    const removeDescriptions = (obj: any) => {
      if (typeof obj !== 'object' || obj === null) return;

      if (obj.properties) {
        for (const key in obj.properties) {
          // Remove description property
          if (obj.properties[key].description) {
            delete obj.properties[key].description;
          }

          // Recursively process nested properties
          removeDescriptions(obj.properties[key]);
        }
      }

      // Handle arrays
      if (obj.items) {
        if (obj.items.description) {
          delete obj.items.description;
        }
        removeDescriptions(obj.items);
      }

      // Handle any other nested objects that might contain descriptions
      if (obj.anyOf) obj.anyOf.forEach(removeDescriptions);
      if (obj.allOf) obj.allOf.forEach(removeDescriptions);
      if (obj.oneOf) obj.oneOf.forEach(removeDescriptions);
    };

    removeDescriptions(clonedSchema);
    return clonedSchema;
  }

  async generateObject<T>(options: GenerateOptions<T>): Promise<GenerateObjectResult<T>> {
    const {
      model,
      schema,
      prompt,
      system,
      messages,
      numRetries = 0,
    } = options;

    if (!model || !schema) {
      throw new Error('Model and schema are required parameters');
    }

    try {
      // Primary attempt with main model
      const result = await generateObject({
        model: getModel(model),
        schema,
        prompt,
        system,
        messages,
        maxTokens: getToolConfig(model).maxTokens,
        temperature: getToolConfig(model).temperature,
      });

      this.tokenTracker.trackUsage(model, result.usage);
      return result;

    } catch (error) {
      // First fallback: Try manual parsing of the error response
      try {
        const errorResult = await this.handleGenerateObjectError<T>(error);
        this.tokenTracker.trackUsage(model, errorResult.usage);
        return errorResult;

      } catch (parseError) {

        if (numRetries > 0) {
          console.error(`${model} failed on object generation -> manual parsing failed -> retry with ${numRetries - 1} retries remaining`);
          return this.generateObject({
            model,
            schema,
            prompt,
            system,
            messages,
            numRetries: numRetries - 1
          });
        } else {
          // Second fallback: Try with fallback model if provided
          console.error(`${model} failed on object generation -> manual parsing failed -> trying fallback with distilled schema`);
          try {
            let failedOutput = '';

            if (NoObjectGeneratedError.isInstance(parseError)) {
              failedOutput = (parseError as any).text;
              // find last `"url":` appear in the string, which is the source of the problem
              failedOutput = failedOutput.slice(0, Math.min(failedOutput.lastIndexOf('"url":'), 8000));
            }

            // Create a distilled version of the schema without descriptions
            const distilledSchema = this.createDistilledSchema(schema);

            const fallbackResult = await generateObject({
              model: getModel('fallback'),
              schema: distilledSchema,
              prompt: `Following the given JSON schema, extract the field from below: \n\n ${failedOutput}`,
              temperature: getToolConfig('fallback').temperature,
            });

            this.tokenTracker.trackUsage('fallback', fallbackResult.usage); // Track against fallback model
            console.log('Distilled schema parse success!');
            return fallbackResult;
          } catch (fallbackError) {
            // If fallback model also fails, try parsing its error response
            try {
              const lastChanceResult = await this.handleGenerateObjectError<T>(fallbackError);
              this.tokenTracker.trackUsage('fallback', lastChanceResult.usage);
              return lastChanceResult;
            } catch (finalError) {
              console.error(`All recovery mechanisms failed`);
              throw error; // Throw original error for better debugging
            }
          }
        }
      }
    }
  }

  private async handleGenerateObjectError<T>(error: unknown): Promise<GenerateObjectResult<T>> {
    if (NoObjectGeneratedError.isInstance(error)) {
      console.error('Object not generated according to schema, fallback to manual parsing');
      try {
        // First try standard JSON parsing
        const partialResponse = JSON.parse((error as any).text);
        console.log('JSON parse success!')
        return {
          object: partialResponse as T,
          usage: (error as any).usage
        };
      } catch (parseError) {
        // Use Hjson to parse the error response for more lenient parsing
        try {
          const hjsonResponse = Hjson.parse((error as any).text);
          console.log('Hjson parse success!')
          return {
            object: hjsonResponse as T,
            usage: (error as any).usage
          };
        } catch (hjsonError) {
          console.error('Both JSON and Hjson parsing failed:', hjsonError);
          throw error;
        }
      }
    }
    throw error;
  }
}