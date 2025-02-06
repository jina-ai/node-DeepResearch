import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Mock environment variables
process.env.GEMINI_API_KEY = 'test-key';
process.env.JINA_API_KEY = 'test-key';

jest.mock('../agent', () => ({
  getResponse: jest.fn().mockResolvedValue({
    result: {
      action: 'answer',
      answer: 'Test answer',
      references: []
    }
  })
}));

describe('CLI', () => {
  test('shows version', async () => {
    const { stdout } = await execAsync('ts-node src/cli.ts --version');
    expect(stdout.trim()).toMatch(/\d+\.\d+\.\d+/);
  });

  test('shows help', async () => {
    const { stdout } = await execAsync('ts-node src/cli.ts --help');
    expect(stdout).toContain('deepresearch');
    expect(stdout).toContain('AI-powered research assistant');
  });

  test('handles invalid token budget', async () => {
    try {
      await execAsync('ts-node src/cli.ts -t invalid "test query"');
      fail('Should have thrown');
    } catch (error) {
      expect((error as { stderr: string }).stderr).toContain('Invalid token budget: must be a number');
    }
  });
});
