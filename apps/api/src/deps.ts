import type { Clock } from '@mitaoe/shared';
import type { Config } from './config';

/** Everything the API needs from the outside world, injected so tests can swap the clock and drivers. */
export interface Deps {
  clock: Clock;
  config: Config;
}
