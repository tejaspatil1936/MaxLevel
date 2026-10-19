import { TestClock } from '@mitaoe/shared';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { initFileStore, initFirestore } from '../firebase';
import { importData } from '../import-data';
import type { ScriptedLlm } from '../llm/scripted';
import { selectLlm } from '../llm/select';
import { clearFirestore } from '../test-support/emulators';
import { blankPdf, IMPORT_NOW, importJobs } from '../test-support/import-jobs';
import { importHandler } from './import';
import { localTaskQueue } from './local-queue';

// IMP-07 on the emulators: the job records the configured provider and model, the tokens of its successful calls and
// their estimated cost, and the worker writes one `import.job.done` line with them.

const db = initFirestore();
const files = initFileStore();
const clock = new TestClock();
const jobs = importJobs(db, files, () => ({}) as FastifyInstance);
const QUESTION = { prompt: 'What is 2 + 2?', options: ['3', '4'], correct: [1] };

/** The handler with the model LLM_PROVIDER and LLM_MODEL name, and the log lines it wrote. */
function worker(env: NodeJS.ProcessEnv) {
  const llm = selectLlm(loadConfig({ NODE_ENV: 'test', LLM_PROVIDER: 'mock', ...env })) as ScriptedLlm;
  const lines: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  const run = importHandler({
    imports: importData(db),
    files,
    clock,
    queue: localTaskQueue(db, clock),
    llm,
    log: { info: (obj, msg) => lines.push({ obj: obj as Record<string, unknown>, msg }) },
  });
  return { llm, lines, run: (jobId: string) => run({ orgId: 'org-a', jobId }) };
}

beforeEach(async () => {
  await clearFirestore();
  clock.set(IMPORT_NOW);
  await jobs.org.set({ orgId: 'org-a', timezone: 'Asia/Kolkata' });
  await jobs.org.collection('tests').doc('t1').set({ orgId: 'org-a', title: 'Day 1' });
});

describe('import usage', () => {
  it('IMP-07 provider and model come from LLM_PROVIDER and LLM_MODEL; tokens and cost are on the job and logged', async () => {
    const w = worker({
      LLM_MODEL: 'mock-model-2',
      LLM_PRICE_INPUT_USD_PER_MTOK: '2',
      LLM_PRICE_OUTPUT_USD_PER_MTOK: '10',
    });
    w.llm.setScript({ pages: { '1': [QUESTION], '2': [QUESTION] }, usage: { inputTokens: 1500, outputTokens: 300 } });
    const id = await jobs.create('paper.pdf', 'pdf', await blankPdf(2));
    expect(await w.run(id)).toBe('ready: 2 drafts');
    const job = await jobs.job(id);
    expect(job).toMatchObject({ provider: 'mock', model: 'mock-model-2', tokens: { input: 3000, output: 600 } });
    // 3,000 / 1e6 × $2 + 600 / 1e6 × $10
    expect(job.costEstimate).toBeCloseTo(0.012, 10);
    expect(w.lines).toEqual([
      {
        msg: 'import.job.done',
        obj: {
          event: 'import.job.done',
          orgId: 'org-a',
          jobId: id,
          format: 'pdf',
          pages: 2,
          drafts: 2,
          provider: 'mock',
          model: 'mock-model-2',
          tokens: { input: 3000, output: 600 },
          costEstimate: job.costEstimate,
        },
      },
    ]);
  });

  it('IMP-07 tokens are summed over successful calls only, with the mock prices by default', async () => {
    const w = worker({});
    w.llm.setScript({ pages: { '1': [QUESTION] }, failures: { '1': 1 } });
    const id = await jobs.create('notes.txt', 'txt', Buffer.from('1. What is 2 + 2?\n'));
    await w.run(id);
    expect(await jobs.job(id)).toMatchObject({ status: 'retrying', tokens: { input: 0, output: 0 }, costEstimate: 0 });
    clock.advance(60_000);
    await w.run(id);
    const job = await jobs.job(id);
    expect(job).toMatchObject({ status: 'ready', model: 'mock-model', tokens: { input: 1000, output: 200 } });
    expect(job.costEstimate).toBeCloseTo(0.0018, 10);
    expect(w.lines.map((l) => l.msg)).toEqual(['import.job.done']);
  });

  it('IMP-07 a JSON import records no provider, model, tokens or cost, and logs none', async () => {
    const w = worker({});
    const id = await jobs.create(
      'q.json',
      'json',
      Buffer.from(JSON.stringify({ format: 'mitaoe-questions/1', questions: [{ ...QUESTION, correct: 'B' }] })),
    );
    expect(await w.run(id)).toBe('ready: 1 drafts');
    const job = await jobs.job(id);
    for (const k of ['provider', 'model', 'tokens', 'costEstimate']) expect(job[k], k).toBeUndefined();
    expect(w.lines).toEqual([
      {
        msg: 'import.job.done',
        obj: { event: 'import.job.done', orgId: 'org-a', jobId: id, format: 'json', pages: 1, drafts: 1 },
      },
    ]);
    expect(w.llm.calls()).toEqual([]);
  });
});
