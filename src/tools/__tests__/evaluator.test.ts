import { evaluateAnswer } from '../evaluator';
import { TokenTracker } from '../../utils/token-tracker';

describe('evaluateAnswer', () => {
  it('should evaluate answer definitiveness', async () => {
    const tokenTracker = new TokenTracker();
    const { response } = await evaluateAnswer(
      'What is TypeScript?',
      'TypeScript is a strongly typed programming language that builds on JavaScript.',
      tokenTracker
    );
    expect(response).toHaveProperty('is_definitive');
    expect(response).toHaveProperty('reasoning');
  });

  it('should track token usage', async () => {
    const tokenTracker = new TokenTracker();
    const spy = jest.spyOn(tokenTracker, 'trackUsage');
    const { tokens } = await evaluateAnswer(
      'What is TypeScript?',
      'TypeScript is a strongly typed programming language that builds on JavaScript.',
      tokenTracker
    );
    expect(spy).toHaveBeenCalledWith('evaluator', tokens);
    expect(tokens).toBeGreaterThan(0);
  });
});
