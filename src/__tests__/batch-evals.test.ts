import fs from 'fs/promises';
import { batchEvaluate } from '../evals/batch-evals';

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
}));

jest.mock('../agent', () => ({
  getResponse: jest.fn(async () => ({
    result: { answer: 'The library opens at 9.' },
    context: {
      actionTracker: { getState: () => ({ totalStep: 1 }) },
      tokenTracker: { getTotalUsage: () => ({ totalTokens: 10 }) },
    },
  })),
}));

jest.mock('@ai-sdk/google', () => {
  const { createGoogleGenerativeAI } = jest.requireActual('@ai-sdk/google');
  return {
    createGoogleGenerativeAI: (options: Record<string, unknown>) => createGoogleGenerativeAI({
      ...options,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('gemini-3.1-flash-lite-preview:generateContent')) {
          return new Response(JSON.stringify({ error: { message: 'Model retired' } }), { status: 404 });
        }
        expect(url.hostname).toBe('generativelanguage.googleapis.com');
        expect(url.pathname).toMatch(/\/models\/gemini-3\.1-flash-lite:generateContent$/);
        const body = JSON.parse(String(init?.body));
        expect(body.contents[0].parts[0].text).toContain('The library opens at 9.');
        expect(body.generationConfig.responseMimeType).toBe('application/json');
        const evaluation = JSON.stringify({ pass: true, reason: 'Both answers say 9.' });
        return new Response(JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text: evaluation }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 },
        }), { headers: { 'Content-Type': 'application/json' } });
      },
    }),
  };
});

test('batch evaluation uses a supported model and records the structured result', async () => {
  jest.mocked(fs.readFile).mockResolvedValue(JSON.stringify([
    { question: 'When does the library open?', answer: 'The library opens at 9.' },
  ]));
  await batchEvaluate('questions.json');
  const [, output] = jest.mocked(fs.writeFile).mock.calls[0];
  const report = JSON.parse(String(output));
  expect(report.results[0]).toMatchObject({ pass: true, reason: 'Both answers say 9.' });
  expect(report.statistics.pass_rate).toBe(100);
});
