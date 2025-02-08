import { EventEmitter } from 'events';

import { TokenUsage, TokenCategory } from '../types';

export class TokenTracker extends EventEmitter {
  private usages: TokenUsage[] = [];
  private budget?: number;

  constructor(budget?: number) {
    super();
    this.budget = budget;
  }

  trackUsage(tool: string, tokens: number, category?: TokenCategory) {
    const currentTotal = this.getTotalUsage();
    if (this.budget && currentTotal + tokens > this.budget) {
      console.error(`Token budget exceeded: ${currentTotal + tokens} > ${this.budget}`);
    }
    // Only track usage if we're within budget
    if (!this.budget || currentTotal + tokens <= this.budget) {
      const usage = { tool, tokens, category };
      this.usages.push(usage);
      this.emit('usage', usage);
    }
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

  getOpenAIUsage(): {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details: {
      reasoning_tokens: number;
      accepted_prediction_tokens: number;
      rejected_prediction_tokens: number;
    };
  } {
    const categoryBreakdown = this.usages.reduce((acc, { tokens, category }) => {
      if (category) {
        acc[category] = (acc[category] || 0) + tokens;
      }
      return acc;
    }, {} as Record<string, number>);

    const details = {
      reasoning_tokens: categoryBreakdown.reasoning || 0,
      accepted_prediction_tokens: categoryBreakdown.accepted || 0,
      rejected_prediction_tokens: categoryBreakdown.rejected || 0
    };

    // Only use the detailed token counts for completion tokens
    const completion_tokens = 
      details.reasoning_tokens + 
      details.accepted_prediction_tokens + 
      details.rejected_prediction_tokens;

    const prompt_tokens = categoryBreakdown.prompt || 0;
    const total_tokens = prompt_tokens + completion_tokens;

    return {
      prompt_tokens,
      completion_tokens,
      total_tokens,
      completion_tokens_details: details
    };
  }

  getVercelUsage(): {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } {
    const openAIUsage = this.getOpenAIUsage();
    return {
      promptTokens: openAIUsage.prompt_tokens,
      completionTokens: openAIUsage.completion_tokens,
      totalTokens: openAIUsage.total_tokens
    };
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
