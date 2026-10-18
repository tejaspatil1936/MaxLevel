import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from '../firebase';
import { clearEmulators } from '../test-support/emulators';
import { questionImagePrefix, questionImageStore } from './question-images';

const firebase = initFirebase();
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

beforeEach(async () => {
  await clearEmulators();
});

describe('question image store', () => {
  it("A11Y-10 SEC-06 an image is stored under its test's folder and read back as a data URL", async () => {
    const store = questionImageStore(firebase);
    const saved = await store.save('org-a', 't1', { contentType: 'image/png', data: PNG });
    expect(saved.path.startsWith(questionImagePrefix('org-a', 't1'))).toBe(true);
    expect(saved.path).toMatch(/\.png$/);
    expect(saved.url).toBe(`data:image/png;base64,${PNG}`);
    const missing = `${questionImagePrefix('org-a', 't1')}missing.png`;
    expect(await questionImageStore(firebase).dataUrls([saved.path, missing])).toEqual({ [saved.path]: saved.url });
  });

  it('SEC-06 a file whose bytes are not the declared image type is refused', async () => {
    const store = questionImageStore(firebase);
    const text = Buffer.from('not an image').toString('base64');
    await expect(store.save('org-a', 't1', { contentType: 'image/png', data: text })).rejects.toMatchObject({
      statusCode: 400,
      details: { field: 'image' },
    });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await expect(
      store.save('org-a', 't1', { contentType: 'image/svg+xml', data: svg.toString('base64') }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
