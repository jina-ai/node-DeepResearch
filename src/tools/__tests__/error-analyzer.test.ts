import { analyzeSteps } from '../error-analyzer';

describe('analyzeSteps', () => {
  it('should analyze error steps', async () => {
    const { response } = await analyzeSteps(['Step 1: Search failed', 'Step 2: Invalid query']);
    expect(response).toHaveProperty('recap');
    expect(response).toHaveProperty('blame');
    expect(response).toHaveProperty('improvement');
  });
});
