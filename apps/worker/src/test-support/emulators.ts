// Clears this test project's Firestore emulator data. Test use only.
export async function clearFirestore(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const project = process.env.GCLOUD_PROJECT;
  if (!host || !project) throw new Error('clearFirestore needs FIRESTORE_EMULATOR_HOST and GCLOUD_PROJECT');
  const res = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Clearing Firestore failed: ${res.status} ${await res.text()}`);
}
