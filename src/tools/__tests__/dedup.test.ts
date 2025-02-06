import { dedupQueries } from '../dedup';
import { LLMProvider } from '../../config';

describe('dedupQueries', () => {
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

      it('should remove duplicate queries', async () => {
        jest.setTimeout(10000);
        const queries = ['typescript tutorial', 'typescript tutorial', 'javascript basics'];
        const { unique_queries } = await dedupQueries(queries, []);
        expect(unique_queries).toHaveLength(2);
        expect(unique_queries).toContain('javascript basics');
      });

      it('should handle empty input', async () => {
        const { unique_queries } = await dedupQueries([], []);
        expect(unique_queries).toHaveLength(0);
      });
    });
  });
});
