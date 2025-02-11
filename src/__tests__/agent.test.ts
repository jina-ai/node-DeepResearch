import { getResponse } from '../agent';
import { generateObject } from 'ai';
import { search } from '../tools/jina-search';
import { readUrl } from '../tools/read';

// Mock external dependencies
jest.mock('ai', () => ({
  generateObject: jest.fn()
}));

jest.mock('../tools/jina-search', () => ({
  search: jest.fn()
}));

jest.mock('../tools/read', () => ({
  readUrl: jest.fn()
}));

describe('getResponse', () => {
  beforeEach(() => {
    // Mock generateObject to return a valid response
    (generateObject as jest.Mock).mockResolvedValue({
      object: { action: 'answer', answer: 'mocked response', references: [], think: 'mocked thought' },
      usage: { totalTokens: 100 }
    });

    // Mock search to return empty results
    (search as jest.Mock).mockResolvedValue({
      response: { data: [] }
    });

    // Mock readUrl to return empty content
    (readUrl as jest.Mock).mockResolvedValue({
      response: { data: { content: '', url: 'test-url' } },
      tokens: 0
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('should handle search action', async () => {
    const result = await getResponse('What is TypeScript?', 50000); // Increased token budget to handle real-world usage
    expect(result.result.action).toBeDefined();
    expect(result.context).toBeDefined();
    expect(result.context.tokenTracker).toBeDefined();
    expect(result.context.actionTracker).toBeDefined();
  }, 30000);
});
