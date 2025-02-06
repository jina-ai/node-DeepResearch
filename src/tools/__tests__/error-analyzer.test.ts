import { analyzeSteps } from '../error-analyzer';
import { LLMProvider } from '../../config';

describe('analyzeSteps', () => {
  const providers: Array<LLMProvider> = ['openai', 'gemini'];
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  providers.forEach(provider => {
    describe(`with ${provider} provider`, () => {
      beforeEach(() => {
        process.env.LLM_PROVIDER = provider;
      });

      it('should analyze error steps', async () => {
        const { response } = await analyzeSteps(['Step 1: Search failed', 'Step 2: Invalid query']);
        expect(response).toHaveProperty('recap');
        expect(response).toHaveProperty('blame');
        expect(response).toHaveProperty('improvement');
      });
    });
  });
});
