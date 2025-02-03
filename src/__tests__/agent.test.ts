import { getResponse } from '../agent';

describe('getResponse', () => {
  it('should handle search action', async () => {
    const result = await getResponse('What is TypeScript?', 1000);
    expect(result.result.action).toBeDefined();
    expect(result.context).toBeDefined();
    expect(result.context.tokenTracker).toBeDefined();
    expect(result.context.actionTracker).toBeDefined();
  });

  it('should respect token budget', async () => {
    try {
      await getResponse('What is TypeScript?', 100);
      fail('Expected token budget error');
    } catch (error: any) {
      expect(error.message).toContain('Token budget exceeded');
    }
  });
});
