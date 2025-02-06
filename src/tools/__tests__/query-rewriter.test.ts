import { rewriteQuery } from '../query-rewriter';
import { LLMProvider } from '../../config';

describe('rewriteQuery', () => {
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

      it('should rewrite search query', async () => {
        const { queries } = await rewriteQuery({
          action: 'search',
          searchQuery: 'how does typescript work',
          think: 'Understanding TypeScript basics'
        });
        expect(Array.isArray(queries)).toBe(true);
        expect(queries.length).toBeGreaterThan(0);
      });
    });
  });
});
