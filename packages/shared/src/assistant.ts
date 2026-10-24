import { z } from 'zod';
import { eligibilityRulesSchema } from './eligibility';
import { docIdSchema } from './ids';
import { isoDateSchema, seriesTitleSchema } from './series';
import { dailyWindowSchema, seriesDefaultsSchema, storedSettingsSchema } from './settings';
import { sectionInputSchema, testTitleSchema } from './test-record';

export const diagnosticIssueSchema = z.object({
  severity: z.enum(['critical', 'warning', 'info']),
  code: z.string(),
  title: z.string(),
  message: z.string(),
  howToFix: z.string(),
  actionHref: z.string().optional(),
  actionLabel: z.string().optional(),
});
export type DiagnosticIssue = z.infer<typeof diagnosticIssueSchema>;

export const diagnosticCheckSchema = z.object({
  name: z.string(),
  status: z.enum(['passed', 'failed', 'warning']),
  detail: z.string(),
});
export type DiagnosticCheck = z.infer<typeof diagnosticCheckSchema>;

export const diagnosticReportSchema = z.object({
  testId: docIdSchema,
  testTitle: z.string(),
  testStatus: z.string(),
  seriesId: docIdSchema,
  seriesTitle: z.string(),
  seriesStatus: z.string(),
  isVisibleToStudents: z.boolean(),
  eligibleStudentCount: z.number().int().nonnegative(),
  totalRegisteredCount: z.number().int().nonnegative(),
  issues: z.array(diagnosticIssueSchema),
  checks: z.array(diagnosticCheckSchema),
  summary: z.string(),
});
export type DiagnosticReport = z.infer<typeof diagnosticReportSchema>;

export const assistantChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});
export type AssistantChatMessage = z.infer<typeof assistantChatMessageSchema>;

export const assistantChatRequestSchema = z.object({
  messages: z.array(assistantChatMessageSchema).min(1).max(30),
  context: z
    .object({
      testId: docIdSchema.optional(),
      seriesId: docIdSchema.optional(),
    })
    .optional(),
});
export type AssistantChatRequest = z.infer<typeof assistantChatRequestSchema>;

export const assistantActionTypeSchema = z.enum(['create_series', 'create_test', 'update_series', 'update_test']);
export type AssistantActionType = z.infer<typeof assistantActionTypeSchema>;

export const proposalDiffSchema = z.object({
  field: z.string(),
  label: z.string(),
  value: z.string(),
  previous: z.string().optional(),
});
export type ProposalDiff = z.infer<typeof proposalDiffSchema>;

export const seriesProposalPayloadSchema = z.object({
  title: seriesTitleSchema,
  description: z.string().max(2000).optional(),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  dailyWindow: dailyWindowSchema.optional(),
  defaults: seriesDefaultsSchema.default({}),
  eligibility: eligibilityRulesSchema.default({ departmentIds: [], graduationYears: [], include: [], exclude: [] }),
});
export type SeriesProposalPayload = z.infer<typeof seriesProposalPayloadSchema>;

export const testProposalPayloadSchema = z.object({
  seriesId: docIdSchema,
  title: testTitleSchema,
  company: z.string().max(120).optional(),
  dayNumber: z.string().max(40).optional(),
  scheduledDate: isoDateSchema,
  overrides: storedSettingsSchema.default({}),
  eligibility: eligibilityRulesSchema.default({ departmentIds: [], graduationYears: [], include: [], exclude: [] }),
  sections: z.array(sectionInputSchema).max(20).optional(),
});
export type TestProposalPayload = z.infer<typeof testProposalPayloadSchema>;

export const assistantActionProposalSchema = z.object({
  id: z.string(),
  actionType: assistantActionTypeSchema,
  title: z.string().min(1),
  summary: z.string(),
  seriesId: docIdSchema.optional(),
  testId: docIdSchema.optional(),
  seriesData: seriesProposalPayloadSchema.optional(),
  testData: testProposalPayloadSchema.optional(),
  diffs: z.array(proposalDiffSchema),
  requiresConfirmation: z.boolean().default(true),
  warning: z.string().optional(),
});
export type AssistantActionProposal = z.infer<typeof assistantActionProposalSchema>;

export const assistantChatResponseSchema = z.object({
  reply: z.string(),
  diagnostic: diagnosticReportSchema.nullable().optional(),
  suggestions: z.array(z.string()).optional(),
  proposal: assistantActionProposalSchema.nullable().optional(),
});
export type AssistantChatResponse = z.infer<typeof assistantChatResponseSchema>;

export const applyActionRequestSchema = z.object({
  proposal: assistantActionProposalSchema,
});
export type ApplyActionRequest = z.infer<typeof applyActionRequestSchema>;

export const applyActionResponseSchema = z.object({
  success: z.boolean(),
  actionType: assistantActionTypeSchema,
  createdId: z.string().optional(),
  seriesId: z.string().optional(),
  testId: z.string().optional(),
  message: z.string(),
  editUrl: z.string(),
});
export type ApplyActionResponse = z.infer<typeof applyActionResponseSchema>;
