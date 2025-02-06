import { evaluateAnswer } from '../evaluator';
import { TokenTracker } from '../../utils/token-tracker';
import { LLMProvider } from '../../config';

describe('evaluateAnswer', () => {
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

      it('should evaluate answer definitiveness', async () => {
        const tokenTracker = new TokenTracker();
        const { response } = await evaluateAnswer(
          'What is TypeScript?',
          'TypeScript is a strongly typed programming language that builds on JavaScript.',
          tokenTracker
        );
        expect(response).toHaveProperty('is_definitive');
        expect(response).toHaveProperty('reasoning');
      });

      it('should track token usage', async () => {
        const tokenTracker = new TokenTracker();
        const spy = jest.spyOn(tokenTracker, 'trackUsage');
        const { tokens } = await evaluateAnswer(
          'What is TypeScript?',
          'TypeScript is a strongly typed programming language that builds on JavaScript.',
          tokenTracker
        );
        expect(spy).toHaveBeenCalledWith('evaluator', tokens);
        expect(tokens).toBeGreaterThan(0);
      });
    });
  });
});
