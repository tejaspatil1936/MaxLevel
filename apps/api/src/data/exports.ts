import type { ExportFormat, ExportScope, ExportStatus } from '@mitaoe/shared';
import type { Firestore } from 'firebase-admin/firestore';
import { writer, type Tx } from './tx';

/** `organizations/{orgId}/exports/{exportId}` (spec 10, EXP-03): the API stores it queued, the worker fills it. */
export interface ExportRecord {
  id: string;
  orgId: string;
  scope: ExportScope;
  refId: string;
  format: ExportFormat;
  status: ExportStatus;
  /** Where the worker saves the file in Storage, under the organization's folder. */
  filePath: string;
  filename: string;
  /** The uid of the admin or super admin who asked for it. */
  createdBy: string;
  createdAt: number;
}

export function exportsData(db: Firestore) {
  const col = (orgId: string) => db.collection(`organizations/${orgId}/exports`);
  return {
    /** A new export ID in the organization, for the record and its audit entry written in one batch. */
    newExportId(orgId: string): string {
      return col(orgId).doc().id;
    },

    addExport(orgId: string, tx: Tx, rec: Omit<ExportRecord, 'orgId'>): void {
      const { id, ...fields } = rec;
      writer(tx).create(col(orgId).doc(id), { ...fields, orgId });
    },

    /** An export of this organization, or null (another organization's export is not found, ORG-05). */
    async getExport(orgId: string, exportId: string): Promise<ExportRecord | null> {
      const d = await col(orgId).doc(exportId).get();
      if (!d.exists) return null;
      return { ...(d.data() as Omit<ExportRecord, 'id'>), id: d.id };
    },
  };
}
