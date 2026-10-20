import { connect } from 'node:net';

/** The worker's integration tests need the Firestore emulator; scripts/with-emulators.sh starts it when needed. */
export default async function setup() {
  const open = await new Promise<boolean>((resolve) => {
    const s = connect(8080, '127.0.0.1');
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
  });
  if (!open) throw new Error('The Firestore emulator is not running on 8080. Use scripts/emulators.sh start.');
}
