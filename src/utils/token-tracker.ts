import { EventEmitter } from 'events';

import { TokenUsage } from '../types';
import { LanguageModelUsage } from "ai";
import { logInfo, logError, logDebug, logWarning } from '../logging';

export class TokenTracker extends EventEmitter {
  private usages: TokenUsage[] = [];
  private budget?: number;

  constructor(budget?: number) {
    super();
    this.budget = budget;

    if ('asyncLocalContext' in process) {
      const asyncLocalContext = process.asyncLocalContext as any;
      this.on('usage', () => {
        if (asyncLocalContext.available()) {
          asyncLocalContext.ctx.chargeAmount = this.getTotalUsage().totalTokens;
        }
      });

    }
  }

  trackUsage(tool: string, usage: LanguageModelUsage) {
    const u = { tool, usage };
    this.usages.push(u);
    this.emit('usage', usage);
  }

  getTotalUsage(): LanguageModelUsage {
    return this.usages.reduce((acc, { usage }) => {
      // CompletionTokens > 0 means LLM usage, apply 3x multiplier
      const scaler = usage.completionTokens > 0 ? 3 : 1;
      acc.promptTokens += usage.promptTokens * scaler;
      acc.completionTokens += usage.completionTokens * scaler;
      acc.totalTokens += usage.totalTokens * scaler;
      return acc;
    }, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  }

  getTotalUsageSnakeCase(): { prompt_tokens: number, completion_tokens: number, total_tokens: number } {
    return this.usages.reduce((acc, { usage }) => {
      acc.prompt_tokens += usage.promptTokens;
      acc.completion_tokens += usage.completionTokens;
      acc.total_tokens += usage.totalTokens;
      return acc;
    }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  }

  getUsageBreakdown(): Record<string, number> {
    return this.usages.reduce((acc, { tool, usage }) => {
      acc[tool] = (acc[tool] || 0) + usage.totalTokens;
      return acc;
    }, {} as Record<string, number>);
  }


  printSummary() {
    const breakdown = this.getUsageBreakdown();
    logInfo('Token Usage Summary:', {
      budget: this.budget,
      total: this.getTotalUsage(),
      breakdown
    });
  }

  reset() {
    this.usages = [];
  }
}
