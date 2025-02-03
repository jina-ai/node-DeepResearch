import { search } from '../search';
import { TokenTracker } from '../../utils/token-tracker';

describe('search', () => {
  it('should perform search with Jina API', async () => {
    const tokenTracker = new TokenTracker();
    const { response } = await search('TypeScript programming', process.env.JINA_API_KEY!, tokenTracker);
    expect(response).toBeDefined();
    expect(response.data).toBeDefined();
    expect(Array.isArray(response.data)).toBe(true);
    expect(response.data.length).toBeGreaterThan(0);
  });

  it('should handle empty query', async () => {
    await expect(search('', process.env.JINA_API_KEY!)).rejects.toThrow();
  });
});
