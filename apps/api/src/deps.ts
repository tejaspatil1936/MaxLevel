import type { Clock, TaskQueue } from '@mitaoe/shared';
import type { Config } from './config';
import type { FirebaseHandles } from './firebase';
import type { TaskDispatcher } from './tasks/dispatcher';

/** Everything the API needs from the outside world, injected so tests can swap the clock and drivers. */
export interface Deps {
  clock: Clock;
  config: Config;
  firebase: FirebaseHandles;
  /** Background work goes through this queue only (PLAN section 3). */
  queue: TaskQueue;
  /** The local queue's dispatcher, when this process runs it (server.ts); the test-only run-due route uses it. */
  dispatcher?: TaskDispatcher;
}
