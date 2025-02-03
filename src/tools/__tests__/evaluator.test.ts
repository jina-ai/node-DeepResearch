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
});
