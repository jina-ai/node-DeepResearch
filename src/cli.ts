#!/usr/bin/env node
import { Command } from 'commander';
import { getResponse } from './agent';
import { version } from '../package.json';
import { logInfo, logError } from './logging';

const program = new Command();

program
  .name('deepresearch')
  .description('AI-powered research assistant that keeps searching until it finds the answer')
  .version(version)
  .argument('<query>', 'The research query to investigate')
  .option('-t, --token-budget <number>', 'Maximum token budget', (val) => {
    const num = parseInt(val);
    if (isNaN(num)) throw new Error('Invalid token budget: must be a number');
    return num;
  }, 1000000)
  .option('-m, --max-attempts <number>', 'Maximum bad attempts before giving up', (val) => {
    const num = parseInt(val);
    if (isNaN(num)) throw new Error('Invalid max attempts: must be a number');
    return num;
  }, 3)
  .option('-v, --verbose', 'Show detailed progress')
  .action(async (query: string, options: any) => {
    try {
      const { result } = await getResponse(
        query,
        parseInt(options.tokenBudget),
        parseInt(options.maxAttempts),
      );

      if (result.action === 'answer') {
        logInfo('\nAnswer:', { answer: result.answer });
        if (result.references?.length) {
          logInfo('\nReferences:');
          for (const ref of result.references) {
            logInfo(`- ${ref.url}`);
            logInfo(`  "${ref.exactQuote}"`);
          }
        }
      }
    } catch (error) {
      logError('Error:', { error: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    }
  });

program.parse();
