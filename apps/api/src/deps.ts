import type { Clock } from '@mitaoe/shared';
import type { Config } from './config';
import type { FirebaseHandles } from './firebase';

/** Everything the API needs from the outside world, injected so tests can swap the clock and drivers. */
export interface Deps {
  clock: Clock;
  config: Config;
  firebase: FirebaseHandles;
}
