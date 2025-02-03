import { readUrl } from '../read';
import { TokenTracker } from '../../utils/token-tracker';

describe('readUrl', () => {
  it('should read and parse URL content', async () => {
    const tokenTracker = new TokenTracker();
    const { response } = await readUrl('https://www.typescriptlang.org', process.env.JINA_API_KEY!, tokenTracker);
    expect(response).toHaveProperty('code');
    expect(response).toHaveProperty('status');
    expect(response.data).toHaveProperty('content');
    expect(response.data).toHaveProperty('title');
  });

  it('should handle invalid URLs', async () => {
    await expect(readUrl('invalid-url', process.env.JINA_API_KEY!)).rejects.toThrow();
  });
});
