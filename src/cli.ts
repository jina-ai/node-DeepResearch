#!/usr/bin/env node
import { Command } from 'commander';
import { getResponse } from './agent';
import { version } from '../package.json';

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
        console.log('\nAnswer:', result.answer);
        if (result.references?.length) {
          console.log('\nReferences:');
          result.references.forEach(ref => {
            console.log(`- ${ref.url}`);
            console.log(`  "${ref.exactQuote}"`);
          });
        }
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();
