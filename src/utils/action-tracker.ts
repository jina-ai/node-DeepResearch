import {EventEmitter} from 'events';
import {StepAction} from '../types';
import {getI18nText} from "./text-tools";

interface ActionState {
  thisStep: StepAction;
  gaps: string[];
  badAttempts: number;
  totalStep: number;
}


export class ActionTracker extends EventEmitter {
  private state: ActionState = {
    thisStep: {action: 'answer', answer: '', references: [], think: ''},
    gaps: [],
    badAttempts: 0,
    totalStep: 0
  };

  trackAction(newState: Partial<ActionState>) {
    this.state = {...this.state, ...newState};
    this.emit('action', this.state.thisStep);
  }

  trackThink(think: string, lang?: string, params = {}) {
    if (lang) {
      think = getI18nText(think, lang, params);
    }
    this.state = {...this.state, thisStep: {...this.state.thisStep, URLTargets: [], think} as StepAction};
    this.emit('action', this.state.thisStep);
  }

  getState(): ActionState {
    return {...this.state};
  }

  reset() {
    this.state = {
      thisStep: {action: 'answer', answer: '', references: [], think: ''},
      gaps: [],
      badAttempts: 0,
      totalStep: 0
    };
  }
}
