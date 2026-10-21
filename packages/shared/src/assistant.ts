import { z } from 'zod';
import { docIdSchema } from './ids';

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

export const assistantChatResponseSchema = z.object({
  reply: z.string(),
  diagnostic: diagnosticReportSchema.nullable().optional(),
  suggestions: z.array(z.string()).optional(),
});
export type AssistantChatResponse = z.infer<typeof assistantChatResponseSchema>;
