import { search } from '../search';
import { TokenTracker } from '../../utils/token-tracker';

describe('search', () => {
  it.skip('should perform search with Jina API (skipped due to insufficient balance)', async () => {
    const tokenTracker = new TokenTracker();
    const { response } = await search('TypeScript programming', process.env.JINA_API_KEY!, tokenTracker);
    expect(response).toBeDefined();
    expect(response.data).toBeDefined();
    if (response.data === null) {
      throw new Error('Response data is null');
    }
    expect(Array.isArray(response.data)).toBe(true);
    expect(response.data.length).toBeGreaterThan(0);
  }, 15000);

  it('should handle empty query', async () => {
    await expect(search('', process.env.JINA_API_KEY!)).rejects.toThrow();
  }, 15000);

  beforeEach(() => {
    jest.setTimeout(15000);
  });
});
