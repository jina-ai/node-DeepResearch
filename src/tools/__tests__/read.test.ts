import { readUrl } from '../read';
import { TokenTracker } from '../../utils/token-tracker';

describe('readUrl', () => {
  it.skip('should read and parse URL content (skipped due to insufficient balance)', async () => {
    const tokenTracker = new TokenTracker();
    const { response } = await readUrl('https://www.typescriptlang.org', process.env.JINA_API_KEY!, tokenTracker);
    expect(response).toHaveProperty('code');
    expect(response).toHaveProperty('status');
    expect(response.data).toHaveProperty('content');
    expect(response.data).toHaveProperty('title');
  }, 15000);

  it.skip('should handle invalid URLs (skipped due to insufficient balance)', async () => {
    await expect(readUrl('invalid-url', process.env.JINA_API_KEY!)).rejects.toThrow();
  }, 15000);

  beforeEach(() => {
    jest.setTimeout(15000);
  });
});
