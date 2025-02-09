import request from 'supertest';
import { EventEmitter } from 'events';
import type { Express } from 'express';

const TEST_SECRET = 'test-secret';
let app: Express;

describe('/v1/chat/completions', () => {
  jest.setTimeout(120000); // Increase timeout for all tests in this suite
  
  beforeEach(async () => {
    // Set NODE_ENV to test to prevent server from auto-starting
    process.env.NODE_ENV = 'test';
    
    // Clean up any existing secret
    const existingSecretIndex = process.argv.findIndex(arg => arg.startsWith('--secret='));
    if (existingSecretIndex !== -1) {
      process.argv.splice(existingSecretIndex, 1);
    }
    
    // Set up test secret and import server module
    process.argv.push(`--secret=${TEST_SECRET}`);
    
    // Import server module (jest.resetModules() is called automatically before each test)
    const { default: serverModule } = await import('../server');
    app = serverModule;
  });
  
  afterEach(async () => {
    // Clean up any remaining event listeners
    const emitter = EventEmitter.prototype;
    emitter.removeAllListeners();
    emitter.setMaxListeners(emitter.getMaxListeners() + 1);
    
    // Clean up test secret
    const secretIndex = process.argv.findIndex(arg => arg.startsWith('--secret='));
    if (secretIndex !== -1) {
      process.argv.splice(secretIndex, 1);
    }

    // Wait for any pending promises to settle
    await new Promise(resolve => setTimeout(resolve, 500));

    // Reset module cache to ensure clean state
    jest.resetModules();
  });
  it('should require authentication when secret is set', async () => {
    // Note: secret is already set in beforeEach
    
    const response = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }]
      });
    expect(response.status).toBe(401);
  });

  it('should allow requests without auth when no secret is set', async () => {
    // Remove secret for this test
    const secretIndex = process.argv.findIndex(arg => arg.startsWith('--secret='));
    if (secretIndex !== -1) {
      process.argv.splice(secretIndex, 1);
    }
    
    // Reload server module without secret
    const { default: serverModule } = await import('../server');
    app = serverModule;
    
    const response = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }]
      });
    expect(response.status).toBe(200);
  });

  it('should reject requests without user message', async () => {
    const response = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${TEST_SECRET}`)
      .send({
        model: 'test-model',
        messages: [{ role: 'developer', content: 'test' }]
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Last message must be from user');
  });

  it('should handle non-streaming request', async () => {
    const response = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${TEST_SECRET}`)
      .send({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }]
      });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      object: 'chat.completion',
      choices: [{
        message: {
          role: 'assistant'
        }
      }]
    });
  });

  it('should track tokens correctly in non-streaming response', async () => {
    // Create a promise that resolves when token tracking is complete
    const tokenTrackingPromise = new Promise<void>((resolve) => {
      const emitter = EventEmitter.prototype;
      const originalEmit = emitter.emit;
      
      // Override emit to detect when token tracking is done
      emitter.emit = function(event: string, ...args: any[]) {
        if (event === 'usage') {
          // Wait for next tick to ensure all token tracking is complete
          process.nextTick(() => {
            emitter.emit = originalEmit;
            resolve();
          });
        }
        return originalEmit.apply(this, [event, ...args]);
      };
    });

    const response = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${TEST_SECRET}`)
      .send({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }]
      });
    
    // Wait for token tracking to complete
    await tokenTrackingPromise;

    expect(response.body.usage).toMatchObject({
      prompt_tokens: expect.any(Number),
      completion_tokens: expect.any(Number),
      total_tokens: expect.any(Number),
      completion_tokens_details: {
        reasoning_tokens: expect.any(Number),
        accepted_prediction_tokens: expect.any(Number),
        rejected_prediction_tokens: expect.any(Number)
      }
    });

    // Verify token counts are reasonable
    expect(response.body.usage.prompt_tokens).toBeGreaterThan(0);
    expect(response.body.usage.completion_tokens).toBeGreaterThan(0);
    expect(response.body.usage.total_tokens).toBe(
      response.body.usage.prompt_tokens + response.body.usage.completion_tokens
    );
  });

  it('should handle streaming request and track tokens correctly', async () => {
    return new Promise<void>((resolve, reject) => {
      let isDone = false;
      let totalCompletionTokens = 0;

      const cleanup = () => {
        clearTimeout(timeoutHandle);
        isDone = true;
        resolve();
      };

      const timeoutHandle = setTimeout(() => {
        if (!isDone) {
          cleanup();
          reject(new Error('Test timed out'));
        }
      }, 30000);

      request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${TEST_SECRET}`)
        .send({
          model: 'test-model',
          messages: [{ role: 'user', content: 'test' }],
          stream: true
        })
        .buffer(true)
        .parse((res, callback) => {
          const response = res as unknown as {
            on(event: 'data', listener: (chunk: Buffer) => void): void;
            on(event: 'end', listener: () => void): void;
            on(event: 'error', listener: (err: Error) => void): void;
          };
          let responseData = '';
          
          response.on('error', (err) => {
            cleanup();
            callback(err, null);
          });

          response.on('data', (chunk) => {
            responseData += chunk.toString();
          });

          response.on('end', () => {
            try {
              callback(null, responseData);
            } catch (err) {
              cleanup();
              callback(err instanceof Error ? err : new Error(String(err)), null);
            }
          });
        })
        .end((err, res) => {
          if (err) return reject(err);
          
          expect(res.status).toBe(200);
          expect(res.headers['content-type']).toBe('text/event-stream');
          
          // Verify stream format and content
          if (isDone) return; // Prevent multiple resolves
          
          const responseText = res.body as string;
          const chunks = responseText
            .split('\n\n')
            .filter((line: string) => line.startsWith('data: '))
            .map((line: string) => JSON.parse(line.replace('data: ', '')));
          
          // Process all chunks
          expect(chunks.length).toBeGreaterThan(0);
          
          // Verify initial chunk format
          expect(chunks[0]).toMatchObject({
            id: expect.any(String),
            object: 'chat.completion.chunk',
            choices: [{
              index: 0,
              delta: { role: 'assistant' },
              logprobs: null,
              finish_reason: null
            }]
          });

          // Verify content chunks have content
          chunks.slice(1).forEach(chunk => {
            const content = chunk.choices[0].delta.content;
            if (content && content.trim()) {
              totalCompletionTokens += 1; // Count 1 token per chunk as per Vercel convention
            }
            expect(chunk).toMatchObject({
              object: 'chat.completion.chunk',
              choices: [{
                delta: expect.objectContaining({
                  content: expect.any(String)
                })
              }]
            });
          });

          // Verify final chunk format if present
          const lastChunk = chunks[chunks.length - 1];
          if (lastChunk?.choices?.[0]?.finish_reason === 'stop') {
            expect(lastChunk).toMatchObject({
              object: 'chat.completion.chunk',
              choices: [{
                delta: {},
                finish_reason: 'stop'
              }]
            });
          }

          // Verify we tracked some completion tokens
          expect(totalCompletionTokens).toBeGreaterThan(0);
          
          // Clean up and resolve
          if (!isDone) {
            cleanup();
          }
        });
    });
  });

  it('should track tokens correctly in error response', async () => {
    const response = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${TEST_SECRET}`)
      .send({
        model: 'test-model',
        messages: [] // Invalid messages array
      });
    
    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toBe('Messages array is required and must not be empty');
    
    // Make another request to verify token tracking after error
    const validResponse = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${TEST_SECRET}`)
      .send({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }]
      });
    
    // Verify token tracking still works after error
    expect(validResponse.body.usage).toMatchObject({
      prompt_tokens: expect.any(Number),
      completion_tokens: expect.any(Number),
      total_tokens: expect.any(Number),
      completion_tokens_details: {
        reasoning_tokens: expect.any(Number),
        accepted_prediction_tokens: expect.any(Number),
        rejected_prediction_tokens: expect.any(Number)
      }
    });

    // Verify token counts are reasonable
    expect(validResponse.body.usage.prompt_tokens).toBeGreaterThan(0);
    expect(validResponse.body.usage.completion_tokens).toBeGreaterThan(0);
    expect(validResponse.body.usage.total_tokens).toBe(
      validResponse.body.usage.prompt_tokens + validResponse.body.usage.completion_tokens
    );
  });

  it('should provide token usage in Vercel AI SDK format', async () => {
    const response = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${TEST_SECRET}`)
      .send({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }]
      });
    
    expect(response.status).toBe(200);
    const usage = response.body.usage;

    expect(usage).toMatchObject({
      prompt_tokens: expect.any(Number),
      completion_tokens: expect.any(Number),
      total_tokens: expect.any(Number),
      completion_tokens_details: {
        reasoning_tokens: expect.any(Number),
        accepted_prediction_tokens: expect.any(Number),
        rejected_prediction_tokens: expect.any(Number)
      }
    });

    // Verify token counts are reasonable
    expect(usage.prompt_tokens).toBeGreaterThan(0);
    expect(usage.completion_tokens).toBeGreaterThan(0);
    expect(usage.total_tokens).toBe(
      usage.prompt_tokens + usage.completion_tokens
    );
  });
});
