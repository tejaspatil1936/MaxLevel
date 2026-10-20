// Clears the Firebase emulators over their REST endpoints. Test and development use only.
const env = process.env;
const project = env.GCLOUD_PROJECT ?? 'demo-mitaoe';

async function call(url: string, init: RequestInit): Promise<void> {
  const res = await fetch(url, init);
  if (!res.ok && res.status !== 404) throw new Error(`${init.method} ${url} failed: ${res.status} ${await res.text()}`);
}

export async function clearEmulators(): Promise<void> {
  const fs = env.FIRESTORE_EMULATOR_HOST;
  const auth = env.FIREBASE_AUTH_EMULATOR_HOST;
  const rtdb = env.FIREBASE_DATABASE_EMULATOR_HOST;
  const storage = env.FIREBASE_STORAGE_EMULATOR_HOST;
  if (!fs || !auth || !rtdb || !storage) throw new Error('clearEmulators needs every *_EMULATOR_HOST variable set');
  await Promise.all([
    call(`http://${fs}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' }),
    call(`http://${auth}/emulator/v1/projects/${project}/accounts`, { method: 'DELETE' }),
    call(`http://${rtdb}/.json?ns=${project}-default-rtdb`, {
      method: 'PUT',
      body: 'null',
      headers: { Authorization: 'Bearer owner' },
    }),
    call(`http://${storage}/internal/reset`, { method: 'POST' }),
  ]);
}
