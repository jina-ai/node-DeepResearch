import request from 'supertest';
import { Response } from 'supertest';
import app from '../server';
import { OPENAI_API_KEY } from '../config';

describe('/v1/chat/completions', () => {
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
    jest.setTimeout(60000); // Increase timeout for streaming test
    
    return new Promise<void>((resolve, reject) => {
      request(app)
        .post('/v1/chat/completions')
        .set('Authorization', `Bearer ${OPENAI_API_KEY}`)
        .send({
          model: 'test-model',
          messages: [{ role: 'user', content: 'test' }],
          stream: true
        })
        .buffer(true)
        .parse((res: Response, callback: (err: Error | null, data: string) => void) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on('end', () => {
            callback(null, data);
          });
        })
        .end((err, res) => {
          if (err) return reject(err);
          
          expect(res.status).toBe(200);
          expect(res.headers['content-type']).toBe('text/event-stream');
          
          // Verify stream format and content
          const chunks = (res.body as string)
            .split('\n\n')
            .filter((chunk: string) => chunk.startsWith('data: '))
            .map((chunk: string) => JSON.parse(chunk.replace('data: ', '')));
          
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
          
          // Last chunk should have finish_reason: "stop"
          expect(chunks[chunks.length - 1].choices[0].finish_reason).toBe('stop');
          
          resolve();
        });
    });
  });
});
