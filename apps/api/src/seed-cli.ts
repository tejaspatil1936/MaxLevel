// pnpm seed: loads the base seed into the running emulators (docs/TEST_ENV.md).
import { systemClock } from '@mitaoe/shared';
import { initFirebase } from './firebase';
import { clearEmulators } from './test-support/emulators';
import { seedBase } from './test-support/seed';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Refusing to seed: FIRESTORE_EMULATOR_HOST is not set, so this is not the emulator.');
  process.exit(1);
}
const { db } = initFirebase();
await clearEmulators();
await seedBase(db, systemClock.now());
console.log('Seeded orgs A and B on the emulators');
process.exit(0);
