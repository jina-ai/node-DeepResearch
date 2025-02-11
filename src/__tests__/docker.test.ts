import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('Docker build', () => {
  jest.setTimeout(300000); // 5 minutes for build

  it('should build Docker image successfully', async () => {
    const { stderr } = await execAsync('docker build -t node-deepresearch-test .');
    expect(stderr).not.toContain('error');
  });

  it('should start container and respond to health check', async () => {
    // Start container with mock API keys
    await execAsync(
      'docker run -d --name test-container -p 3001:3000 ' +
      '-e GEMINI_API_KEY=mock_key ' +
      '-e JINA_API_KEY=mock_key ' +
      'node-deepresearch-test'
    );

    // Wait for container to start
    await new Promise(resolve => setTimeout(resolve, 5000));

    try {
      // Check if server responds
      const { stdout } = await execAsync('curl -s http://localhost:3001/health');
      expect(stdout).toContain('ok');
    } finally {
      // Cleanup
      await execAsync('docker rm -f test-container').catch(console.error);
    }
  });

  afterAll(async () => {
    // Clean up any leftover containers
    await execAsync('docker rm -f test-container').catch(() => {});
    await execAsync('docker rmi node-deepresearch-test').catch(() => {});
  });
});
