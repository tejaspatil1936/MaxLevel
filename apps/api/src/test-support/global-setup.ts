import { connect } from 'node:net';

const PORTS = { auth: 9099, firestore: 8080, database: 9000, storage: 9199 };

const open = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = connect(port, '127.0.0.1');
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
  });

/** Integration tests need the emulators; run them through `pnpm test:int`, which starts them when needed. */
export default async function setup() {
  const closed = [];
  for (const [name, port] of Object.entries(PORTS)) if (!(await open(port))) closed.push(`${name} (${port})`);
  if (closed.length)
    throw new Error(`Firebase emulators are not running: ${closed.join(', ')}. Use scripts/emulators.sh start.`);
}
