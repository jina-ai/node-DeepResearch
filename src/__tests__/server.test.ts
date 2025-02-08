import request from 'supertest';
import app from '../server';
import { OPENAI_API_KEY } from '../config';

describe('/v1/chat/completions', () => {
  jest.setTimeout(60000); // Increase timeout for all tests in this suite
  it('should require authentication', async () => {
    const response = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }]
      });
    expect(response.status).toBe(401);
  });

  it('should reject requests without user message', async () => {
    const response = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${OPENAI_API_KEY}`)
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
      .set('Authorization', `Bearer ${OPENAI_API_KEY}`)
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
      }],
      usage: {
        total_tokens: expect.any(Number),
        prompt_tokens: expect.any(Number),
        completion_tokens: expect.any(Number),
        completion_tokens_details: {
          reasoning_tokens: expect.any(Number),
          accepted_prediction_tokens: expect.any(Number),
          rejected_prediction_tokens: expect.any(Number)
        }
      }
    });
  });

  it('should handle streaming request', async () => {
    return new Promise<void>((resolve, reject) => {
      let isDone = false;
      request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${OPENAI_API_KEY}`)
        .send({
          model: 'test-model',
          messages: [{ role: 'user', content: 'test' }],
          stream: true
        })
        .buffer(true)
        .parse((res, callback) => {
          const response = res as unknown as {
            on(event: 'data' | 'end', listener: (chunk?: Buffer) => void): void;
          };
          let responseData = '';
          response.on('data', (chunk?: Buffer) => {
            if (chunk) {
              responseData += chunk.toString();
            }
          });
          response.on('end', () => {
            callback(null, responseData);
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
          
          // Only resolve once we have all chunks including the final one
          const lastChunk = chunks[chunks.length - 1];
          if (lastChunk?.choices?.[0]?.finish_reason === 'stop') {
            isDone = true;
            expect(chunks.length).toBeGreaterThan(0);
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
            resolve();
          }
        });
    });
  });
});
