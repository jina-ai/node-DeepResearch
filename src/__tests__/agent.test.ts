import { getResponse } from '../agent';

describe('getResponse', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('should handle search action', async () => {
    const result = await getResponse('What is TypeScript?', 10000);
    expect(result.result.action).toBeDefined();
    expect(result.context).toBeDefined();
    expect(result.context.tokenTracker).toBeDefined();
    expect(result.context.actionTracker).toBeDefined();
  }, 30000);
});
