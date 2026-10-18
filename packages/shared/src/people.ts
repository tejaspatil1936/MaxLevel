import { z } from 'zod';
import { pageQuerySchema } from './page';

// Departments, whitelist and students (spec 4).

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
/** A practical email check shared by the import preview and the API (WL-03). */
export const isValidEmail = (email: string) => emailSchema.safeParse(email).success;

export const departmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['active', 'archived']),
  studentCount: z.number().int().nonnegative(),
});
export type Department = z.infer<typeof departmentSchema>;
export const departmentNameSchema = z.string().trim().min(1).max(80);
export const departmentCreateSchema = z.object({ name: departmentNameSchema });
export const departmentPatchSchema = z
  .object({ name: departmentNameSchema, status: z.enum(['active', 'archived']) })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: 'Change the name or the status.' });
export const departmentMergeSchema = z.object({ intoId: z.string().min(1) });

export const WHITELIST_STATUSES = ['invited', 'registered', 'disabled'] as const;
export const whitelistStatusSchema = z.enum(WHITELIST_STATUSES);
export type WhitelistStatus = z.infer<typeof whitelistStatusSchema>;

export const whitelistEntrySchema = z.object({
  email: z.string(),
  prn: z.string().nullable(),
  note: z.string().nullable(),
  status: whitelistStatusSchema,
  studentId: z.string().nullable(),
  source: z.enum(['upload', 'paste', 'single', 'manual']),
  addedAt: z.number(),
});
export type WhitelistEntry = z.infer<typeof whitelistEntrySchema>;

export const whitelistListQuerySchema = pageQuerySchema.extend({
  status: whitelistStatusSchema.optional(),
  q: z.string().trim().max(200).optional(),
});

/** One row as mapped from the uploaded file or pasted list (WL-01, WL-02). */
export const whitelistRowSchema = z.object({
  email: z.string().max(320),
  prn: z.string().trim().max(40).optional(),
  note: z.string().trim().max(200).optional(),
});
export type WhitelistRow = z.infer<typeof whitelistRowSchema>;

export const whitelistImportSchema = z.object({
  mode: z.enum(['preview', 'commit']),
  source: z.enum(['upload', 'paste', 'single']),
  rows: z.array(whitelistRowSchema).min(1).max(5000),
});

export const importReportSchema = z.object({
  total: z.number().int(),
  valid: z.number().int(),
  invalid: z.array(z.object({ row: z.number().int(), email: z.string() })),
  duplicatesInFile: z.array(z.object({ row: z.number().int(), email: z.string() })),
  existing: z.array(z.object({ row: z.number().int(), email: z.string() })),
  toAdd: z.number().int(),
  limit: z.number().int(),
  currentCount: z.number().int(),
  overLimit: z.boolean(),
  committed: z.boolean(),
});
export type ImportReport = z.infer<typeof importReportSchema>;

/**
 * Validation report shown before saving (WL-03): invalid emails, duplicates inside the file, entries already on the
 * list, and whether the total would exceed max_students. Rows are numbered from 1.
 */
export function buildImportReport(
  rows: WhitelistRow[],
  existing: Set<string>,
  limits: { maxStudents: number; currentCount: number },
): Omit<ImportReport, 'committed'> & { accepted: Array<WhitelistRow & { email: string }> } {
  const seen = new Set<string>();
  const invalid: ImportReport['invalid'] = [];
  const duplicatesInFile: ImportReport['duplicatesInFile'] = [];
  const already: ImportReport['existing'] = [];
  const accepted: Array<WhitelistRow & { email: string }> = [];
  rows.forEach((r, i) => {
    const row = i + 1;
    const email = normalizeEmail(r.email);
    if (!isValidEmail(email)) return void invalid.push({ row, email: r.email.trim() });
    if (seen.has(email)) return void duplicatesInFile.push({ row, email });
    seen.add(email);
    if (existing.has(email)) return void already.push({ row, email });
    accepted.push({ ...r, email });
  });
  const total = limits.currentCount + accepted.length;
  return {
    total: rows.length,
    valid: rows.length - invalid.length,
    invalid,
    duplicatesInFile,
    existing: already,
    toAdd: accepted.length,
    limit: limits.maxStudents,
    currentCount: limits.currentCount,
    overLimit: total > limits.maxStudents,
    accepted,
  };
}

export const whitelistBulkSchema = z.object({
  action: z.enum(['disable', 'enable', 'remove']),
  emails: z.array(z.string()).min(1).max(1000),
});
export const bulkResultSchema = z.object({ updated: z.number().int(), skipped: z.number().int() });

export const graduationYearSchema = z.coerce.number().int().min(2000).max(2100);
export const prnSchema = z.string().trim().min(1).max(40);
export const nameSchema = z.string().trim().min(1).max(120);

export const studentSchema = z.object({
  id: z.string(),
  uid: z.string().nullable(),
  email: z.string(),
  name: z.string(),
  prn: z.string(),
  departmentId: z.string(),
  departmentName: z.string(),
  graduationYear: z.number().int(),
  status: whitelistStatusSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Student = z.infer<typeof studentSchema>;

export const STUDENT_SORTS = ['name', 'email', 'prn', 'graduationYear', 'status', 'department'] as const;
export const studentListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  departmentId: z.string().optional(),
  graduationYear: graduationYearSchema.optional(),
  status: whitelistStatusSchema.optional(),
  sort: z.enum(STUDENT_SORTS).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});

export const studentCreateSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  prn: prnSchema,
  departmentId: z.string().min(1),
  graduationYear: graduationYearSchema,
  note: z.string().trim().max(200).optional(),
});
export const studentPatchSchema = z
  .object({
    name: nameSchema,
    prn: prnSchema,
    departmentId: z.string().min(1),
    graduationYear: graduationYearSchema,
    status: z.enum(['registered', 'disabled', 'invited']),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: 'Change at least one field.' });

/** Profile completion and edits by the student (STU-01, STU-02, SEC-08). */
export const profileSchema = z.object({
  name: nameSchema,
  prn: prnSchema,
  departmentId: z.string().min(1),
  graduationYear: graduationYearSchema,
  consent: z.literal(true).optional(),
});

export const studentProfileSchema = z.object({
  studentId: z.string().nullable(),
  name: z.string().nullable(),
  prn: z.string().nullable(),
  departmentId: z.string().nullable(),
  graduationYear: z.number().nullable(),
  /** PRN came from the whitelist entry, so it is shown prefilled and locked (STU-02). */
  prnLocked: z.boolean(),
  /** The org locked profile editing after completion (STU-03). */
  editingLocked: z.boolean(),
  complete: z.boolean(),
  consentGiven: z.boolean(),
  departments: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type StudentProfile = z.infer<typeof studentProfileSchema>;
