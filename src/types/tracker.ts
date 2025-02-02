import { TokenTracker } from '../utils/token-tracker';
import { ActionTracker } from '../utils/action-tracker';

export interface TrackerContext {
  tokenTracker: TokenTracker;
  actionTracker: ActionTracker;
}
