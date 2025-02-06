import { dedupQueries } from '../dedup';

describe('dedupQueries', () => {
  it('should remove duplicate queries', async () => {
    jest.setTimeout(10000); // Increase timeout to 10s
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
