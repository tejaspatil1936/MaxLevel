import { z } from 'zod';
import { examPayloadSchema } from './exam';
import { studentQuestionSchema } from './question';
import { settingsSchema } from './settings';
import { CLIENT_EVENT_TYPES, proctorEventTypeSchema } from './strikes';

// Attempts, answers, events and results (spec 7, 8.1, 10; PLAN section 5 `Attempt`). Times are epoch ms (UTC).
// Student-facing schemas carry no `correctOptionIds` or `explanation`; parsing strips unknown keys (DATA-05).

const ms = z.number().int();
const id = z.string().min(1).max(128);

export const ATTEMPT_STATUSES = ['in_progress', 'submitted', 'auto_submitted', 'terminated', 'reset'] as const;
export const attemptStatusSchema = z.enum(ATTEMPT_STATUSES);
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;
/** Finished attempts take no more answers or events (409 ATTEMPT_FINISHED). */
export const FINISHED_ATTEMPT_STATUSES = ['submitted', 'auto_submitted', 'terminated'] as const;
export const isFinishedAttempt = (status: AttemptStatus) =>
  (FINISHED_ATTEMPT_STATUSES as readonly string[]).includes(status);

/** The draw stored on an attempt (Q-06): questions in exam order, each one's option order, and the pools. */
export const attemptDrawSchema = z.object({
  questionIds: z.array(z.string()),
  optionOrder: z.record(z.string(), z.array(z.string())),
  sections: z.array(z.object({ sectionId: z.string().nullable(), questionIds: z.array(z.string()) })),
});

export const sectionScoreSchema = z.object({
  score: z.number(),
  max: z.number(),
  correct: z.number().int(),
  incorrect: z.number().int(),
  unanswered: z.number().int(),
});
/** The graded result saved on the attempt (EX-17, spec 8.1): scoreAttempt plus the time taken. */
export const attemptResultSchema = sectionScoreSchema.extend({
  pct: z.number(),
  passed: z.boolean().optional(),
  sections: z.record(z.string(), sectionScoreSchema),
  durationSec: z.number().int().min(0),
});
export type AttemptResult = z.infer<typeof attemptResultSchema>;

/** The attempt record (organizations/{orgId}/attempts/{attemptId}); server-side only, never sent to students. */
export const attemptRecordSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  testId: z.string(),
  seriesId: z.string(),
  studentId: z.string(),
  uid: z.string(),
  status: attemptStatusSchema,
  startedAt: ms,
  deadlineAt: ms,
  extraTimeSec: z.number().int().min(0),
  draw: attemptDrawSchema,
  questionServedAt: z.record(z.string(), ms),
  strikesCount: z.number().int().min(0),
  lastStrikeAt: ms.optional(),
  submittedAt: ms.optional(),
  terminationReason: z.string().optional(),
  result: attemptResultSchema.optional(),
  /** OPS-10: a `reset` attempt keeps every record it had and says why, when and by whom (the admin's uid). */
  resetReason: z.string().optional(),
  resetAt: ms.optional(),
  resetBy: z.string().optional(),
  sync: z.object({ backlog: z.number().int().min(0), clockOffsetMs: z.number(), at: ms }).optional(),
});
export type AttemptRecord = z.infer<typeof attemptRecordSchema>;

/** organizations/{orgId}/attempts/{attemptId}/answers/{questionId} (EX-14). */
export const answerRecordSchema = z.object({
  optionId: z.string().nullable(),
  seq: z.number().int().min(0),
  clientTs: ms,
  serverTs: ms,
  lateSync: z.boolean().optional(),
  markedForReview: z.boolean().optional(),
});
export type AnswerRecord = z.infer<typeof answerRecordSchema>;

// ---------- student-facing ----------

/** POST /v1/attempts. */
export const attemptStartSchema = z.object({ testId: id }).strict();

/** The attempt as its student sees it. */
export const studentAttemptSchema = z.object({
  id: z.string(),
  testId: z.string(),
  status: attemptStatusSchema,
  startedAt: ms,
  deadlineAt: ms,
  strikesCount: z.number().int(),
  maxStrikes: z.number().int(),
  submittedAt: ms.optional(),
  /** Why a `terminated` attempt ended: `max_strikes`, or the admin's reason (RES-06, OPS-04). */
  terminationReason: z.string().optional(),
});
export type StudentAttempt = z.infer<typeof studentAttemptSchema>;

/** A question in an attempt: in a section, or `null` for none; still no answer key (DATA-05). */
export const attemptQuestionSchema = studentQuestionSchema.extend({ sectionId: z.string().nullable() });

/** Settings the exam screen and the submitted screen need; none of them reveal answers. */
export const examSettingsSchema = settingsSchema.pick({
  timingMode: true,
  window: true,
  durationMin: true,
  windowEndPolicy: true,
  maxStrikes: true,
  devtoolsPolicy: true,
  fullscreenRequired: true,
  cameraRequired: true,
  secondCamera: true,
  marking: true,
  questionTimeMode: true,
  questionTimeLimitSec: true,
  resultRelease: true,
});
export type ExamSettings = z.infer<typeof examSettingsSchema>;

/** POST /v1/attempts and GET /v1/attempts/{id}: everything the exam screen needs in one response (PERF-03). */
export const attemptPayloadSchema = examPayloadSchema.extend({
  attempt: studentAttemptSchema,
  questions: z.array(attemptQuestionSchema),
  settings: examSettingsSchema,
  answers: z.record(
    z.string(),
    z.object({ optionId: z.string().nullable(), seq: z.number().int(), markedForReview: z.boolean().optional() }),
  ),
  questionServedAt: z.record(z.string(), ms),
  serverTime: ms,
});
export type AttemptPayload = z.infer<typeof attemptPayloadSchema>;

/** PUT /v1/attempts/{id}/answers (EX-10, EX-11, OBS-03). */
export const answerBatchSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            questionId: id,
            optionId: z.string().min(1).max(16).nullable(),
            seq: z.number().int().min(1),
            clientTs: ms,
            markedForReview: z.boolean().optional(),
          })
          .strict(),
      )
      .max(200),
    backlog: z.number().int().min(0),
    clockOffsetMs: z.number().int(),
  })
  .strict();
export type AnswerBatch = z.infer<typeof answerBatchSchema>;

export const answerRejectionCodeSchema = z.enum(['AFTER_DEADLINE', 'QUESTION_TIME_UP', 'QUESTION_NOT_SERVED']);
export const answerBatchResultSchema = z.object({
  saved: z.array(z.string()),
  stale: z.array(z.string()),
  rejected: z.array(z.object({ questionId: z.string(), code: answerRejectionCodeSchema })),
  serverTime: ms,
});
export type AnswerBatchResult = z.infer<typeof answerBatchResultSchema>;

/** POST /v1/attempts/{id}/navigate (Q-12): records a timed question's first serve time. */
export const navigateSchema = z.object({ questionId: id }).strict();
export const navigateResultSchema = z.object({ servedAt: ms, serverTime: ms });

/** Limits on a report's `details`, so a browser cannot store large blobs through the events route. */
export const EVENT_DETAILS_LIMITS = { keys: 20, keyLength: 64, stringLength: 500, bytes: 4096 } as const;

/** A report's `details` (PR-11): flat, at most 20 keys, strings up to 500 characters, at most 4 KB as JSON. */
export const attemptEventDetailsSchema = z
  .record(
    z.string().min(1).max(EVENT_DETAILS_LIMITS.keyLength),
    z.union([z.string().max(EVENT_DETAILS_LIMITS.stringLength), z.number(), z.boolean(), z.null()]),
  )
  .refine((d) => Object.keys(d).length <= EVENT_DETAILS_LIMITS.keys, {
    message: `At most ${EVENT_DETAILS_LIMITS.keys} details.`,
  })
  .refine((d) => new TextEncoder().encode(JSON.stringify(d)).length <= EVENT_DETAILS_LIMITS.bytes, {
    message: `Details are at most ${EVENT_DETAILS_LIMITS.bytes} bytes.`,
  });
export type AttemptEventDetails = z.infer<typeof attemptEventDetailsSchema>;

/** POST /v1/attempts/{id}/events (PR-08): the client reports, the server counts. */
export const attemptEventReportSchema = z
  .object({
    type: z.enum(CLIENT_EVENT_TYPES),
    clientTs: ms,
    details: attemptEventDetailsSchema.default({}),
  })
  .strict();
export type AttemptEventReport = z.infer<typeof attemptEventReportSchema>;
export const attemptEventResultSchema = z.object({
  strikesCount: z.number().int(),
  counted: z.boolean(),
  status: attemptStatusSchema,
});
export type AttemptEventResult = z.infer<typeof attemptEventResultSchema>;

/** POST /v1/attempts/{id}/submit: `time_up` when the client submits because time ran out (EX-16). */
export const attemptSubmitSchema = z.object({ reason: z.literal('time_up').optional() }).strict();
export const attemptSubmitResultSchema = z.object({ status: attemptStatusSchema, submittedAt: ms });

// ---------- admin ----------

/** A stored event (PR-11), as GET /v1/attempts/{id}/events lists it in serverTs order. */
export const attemptEventSchema = z.object({
  id: z.string(),
  type: proctorEventTypeSchema,
  details: z.record(z.string(), z.unknown()),
  clientTs: ms,
  serverTs: ms,
  strikeNumber: z.number().int().min(1).optional(),
});
export type AttemptEvent = z.infer<typeof attemptEventSchema>;
export const attemptEventListSchema = z.object({ items: z.array(attemptEventSchema) });
export type AttemptEventList = z.infer<typeof attemptEventListSchema>;

/** POST /v1/attempts/{id}/terminate, …/reinstate and …/reset (OPS-04, OPS-10): a reason that is not blank. */
export const attemptActionSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export type AttemptActionBody = z.infer<typeof attemptActionSchema>;
/** The attempt's status after the action: `terminated`, `in_progress` or `reset`. */
export const attemptActionResultSchema = z.object({ status: attemptStatusSchema });
export type AttemptActionResult = z.infer<typeof attemptActionResultSchema>;
