import request from 'supertest';
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
    const response = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${OPENAI_API_KEY}`)
      .send({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
        stream: true
      });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/event-stream');
  });
});
