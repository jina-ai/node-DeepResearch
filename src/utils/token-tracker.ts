import { EventEmitter } from 'events';

import { TokenUsage } from '../types';

class TokenTracker extends EventEmitter {
  private usages: TokenUsage[] = [];

  trackUsage(tool: string, tokens: number) {
    this.usages.push({ tool, tokens });
    this.emit('usage', { tool, tokens });
  }

  getTotalUsage(): number {
    return this.usages.reduce((sum, usage) => sum + usage.tokens, 0);
  }

  getUsageBreakdown(): Record<string, number> {
    return this.usages.reduce((acc, { tool, tokens }) => {
      acc[tool] = (acc[tool] || 0) + tokens;
      return acc;
    }, {} as Record<string, number>);
  }

  printSummary() {
    const breakdown = this.getUsageBreakdown();
    console.log('Token Usage Summary:', {
      total: this.getTotalUsage(),
      breakdown
    });
  }

  reset() {
    this.usages = [];
  }
}

export const tokenTracker = new TokenTracker();
