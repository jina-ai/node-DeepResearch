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
          {
            action: "answer",
            think: "Providing a clear definition of TypeScript",
            answer: "TypeScript is a strongly typed programming language that builds on JavaScript.",
            references: []
          },
          ['definitive'],
          tokenTracker
        );
        expect(response).toHaveProperty('pass');
        expect(response).toHaveProperty('think');
        expect(response.type).toBe('definitive');
      });

      it('should evaluate answer plurality', async () => {
        const tokenTracker = new TokenTracker();
        const { response } = await evaluateAnswer(
          'List three programming languages.',
          {
            action: "answer",
            think: "Providing an example of a programming language",
            answer: "Python is a programming language.",
            references: []
          },
          ['plurality'],
          tokenTracker
        );
        expect(response).toHaveProperty('pass');
        expect(response).toHaveProperty('think');
        expect(response.type).toBe('plurality');
        expect(response.plurality_analysis?.expects_multiple).toBe(true);
      });
    });
  });
});
