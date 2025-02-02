import { EventEmitter } from 'events';
import { StepAction } from '../types';

interface ActionState {
  thisStep: StepAction;
  gaps: string[];
  badAttempts: number;
  totalStep: number;
}

export class ActionTracker extends EventEmitter {
  private state: ActionState = {
    thisStep: {action: 'answer', answer: '', references: [], thoughts: ''},
    gaps: [],
    badAttempts: 0,
    totalStep: 0
  };

  trackAction(newState: Partial<ActionState>) {
    this.state = { ...this.state, ...newState };
    this.emit('action', this.state);
  }

  getState(): ActionState {
    return { ...this.state };
  }

  reset() {
    this.state = {
      thisStep: {action: 'answer', answer: '', references: [], thoughts: ''},
      gaps: [],
      badAttempts: 0,
      totalStep: 0
    };
  }
}
