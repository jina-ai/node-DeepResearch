import axiosClient from '../../utils/axios-client';
import { TokenTracker } from '../../utils/token-tracker';
import { tavilySearch } from '../tavily-search';

jest.mock('../../config', () => ({
  TAVILY_API_KEY: 'tavily-test-key',
}));

jest.mock('../../utils/axios-client', () => ({
  post: jest.fn(),
}));

describe('tavilySearch', () => {
  const post = axiosClient.post as jest.Mock;

  beforeEach(() => {
    post.mockReset();
  });

  it('sends a compatible request and returns Tavily results', async () => {
    post.mockResolvedValue({
      data: {
        query: 'latest research',
        results: [{
          title: 'Research result',
          url: 'https://example.com/research',
          content: 'A useful result',
          score: 0.9,
          published_date: '2024-01-02',
        }],
        usage: { credits: 1 },
      },
    });
    const tracker = new TokenTracker();

    const result = await tavilySearch({ q: 'latest research', tbs: 'qdr:w' }, tracker);

    expect(post).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({
        query: 'latest research',
        max_results: 20,
        time_range: 'w',
        include_answer: false,
        include_raw_content: false,
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer tavily-test-key',
        }),
      }),
    );
    expect(result.response.results[0].url).toBe('https://example.com/research');
    expect(tracker.getTotalUsage().totalTokens).toBe(1);
  });

  it('omits unsupported freshness ranges', async () => {
    post.mockResolvedValue({ data: { results: [] } });

    await tavilySearch({ q: 'recent research', tbs: 'qdr:h' });

    expect(post.mock.calls[0][1]).not.toHaveProperty('time_range');
  });

  it('rejects malformed responses', async () => {
    post.mockResolvedValue({ data: { results: null } });

    await expect(tavilySearch({ q: 'research' })).rejects.toThrow('Invalid Tavily search response');
  });
});
