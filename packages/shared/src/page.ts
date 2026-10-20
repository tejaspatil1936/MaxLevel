import { z } from 'zod';

/** Cursor pagination for every list (API-05): ?cursor=…&limit=…, at most 200 per page. */
export const MAX_PAGE = 200;
export const pageQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(50),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
