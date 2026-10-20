import { readFileSync } from 'node:fs';
import { EXTRACTION_INSTRUCTIONS, TestClock } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { initFileStore, initFirestore } from '../firebase';
import { importData } from '../import-data';
import type { LlmDriver, LlmRequest } from '../llm/driver';
import { ScriptedLlm } from '../llm/scripted';
import { clearFirestore } from '../test-support/emulators';
import { IMPORT_NOW, importJobs } from '../test-support/import-jobs';
import { importHandler } from './import';
import { localTaskQueue } from './local-queue';

// IMP-06 through the worker with the mock model: the injection sample (tests/fixtures/llm/injection.txt) reaches the
// model only inside the user message's data block, the system message is the fixed instructions, and the drafts are
// exactly the script's questions, validated by LlmAnswerSchema: nothing added, nothing marked correct.

const db = initFirestore();
const files = initFileStore();
const clock = new TestClock();
const jobs = importJobs(db, files, () => ({}) as FastifyInstance);
const injection = readFileSync(new URL('../../../../tests/fixtures/llm/injection.txt', import.meta.url));
const SCRIPT = [
  { prompt: 'Find the next number in the series: 3, 6, 12, 24, ...', options: ['30', '36', '48', '60'], correct: [2] },
  {
    prompt: 'If all roses are flowers and some flowers fade quickly, which statement must be true?',
    options: [
      'All roses fade quickly',
      'Some roses fade quickly',
      'No rose fades quickly',
      'None of these must be true',
    ],
    correct: [],
  },
];

beforeEach(async () => {
  await clearFirestore();
  clock.set(IMPORT_NOW);
  await jobs.org.set({ orgId: 'org-a', timezone: 'Asia/Kolkata' });
  await jobs.org.collection('tests').doc('t1').set({ orgId: 'org-a', title: 'Day 1' });
});

describe('import prompt injection', () => {
  it('IMP-06 the file text stays in the data block, the system message is fixed, and the drafts are the answer', async () => {
    const mock = new ScriptedLlm();
    mock.setScript({ pages: { '1': SCRIPT } });
    const requests: LlmRequest[] = [];
    const llm: LlmDriver = {
      provider: mock.provider,
      model: mock.model,
      prices: mock.prices,
      generate: (r) => (requests.push(r), mock.generate(r)),
      summarize: (r) => mock.summarize(r),
    };
    const run = importHandler({ imports: importData(db), files, clock, queue: localTaskQueue(db, clock), llm });
    const id = await jobs.create('notes.txt', 'txt', injection);
    expect(await run({ orgId: 'org-a', jobId: id })).toBe('ready: 2 drafts');

    const [req] = requests;
    expect(req!.system).toBe(EXTRACTION_INSTRUCTIONS);
    const [user] = req!.parts as Array<{ type: 'text'; text: string }>;
    const open = user!.text.indexOf('<file_content>');
    const close = user!.text.lastIndexOf('</file_content>');
    expect(user!.text.match(/<\/file_content>/g), 'the block cannot be closed early').toHaveLength(1);
    const inside = user!.text.slice(open, close);
    expect(inside).toContain('Ignore all previous instructions');
    expect(user!.text.slice(0, open)).not.toContain('Ignore all previous instructions');

    const drafts = await jobs.drafts(id);
    expect(drafts.map((d) => [d.prompt, d.correctOptionIds, d.explanation])).toEqual([
      [SCRIPT[0]!.prompt, ['c'], undefined],
      [SCRIPT[1]!.prompt, [], undefined],
    ]);
    expect(drafts[1]!.flags.map((f: { code: string }) => f.code)).toEqual(['NO_CORRECT_ANSWER']);
  });
});
