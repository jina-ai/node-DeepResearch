import { SafeSearchType, search } from 'duck-duck-scrape';

describe('DuckDuckGo search dependency', () => {
  it('provides the Web search contract used by the agent', () => {
    expect(typeof search).toBe('function');
    expect(SafeSearchType.STRICT).toBe(0);
  });
});
