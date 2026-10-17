import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { parseEligibilityFile } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAdmin(req);
    if ("errorResponse" in authResult) {
      return authResult.errorResponse;
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return apiError("No file uploaded. Please upload a CSV or XLSX file.", 400);
    }

    // Cap upload size at 5MB
    if (file.size > 5 * 1024 * 1024) {
      return apiError("Uploaded file exceeds 5MB limit.", 400);
    }

    const fileName = file.name || "upload.csv";
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { validRows, invalidRows } = await parseEligibilityFile(buffer, fileName);

    let added = 0;
    let updated = 0;

    // Process in batches (Firestore allows up to 500 ops per batch)
    const BATCH_SIZE = 400;
    for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
      const chunk = validRows.slice(i, i + BATCH_SIZE);
      const batch = adminDb.batch();

      // Read existing docs in chunk to differentiate between add and update (sanitizing slashes in PRN)
      const toDocId = (prn: string) => encodeURIComponent(prn.trim());
      const refs = chunk.map((r) =>
        adminDb.collection("eligibleUsers").doc(toDocId(r.prn))
      );
      const snapshots = await adminDb.getAll(...refs);

      for (let j = 0; j < chunk.length; j++) {
        const row = chunk[j];
        const snapshot = snapshots[j];
        const ref = refs[j];

        if (snapshot.exists) {
          // Keep existing claimedByUid if already claimed
          const existingData = snapshot.data();
          batch.update(ref, {
            email: row.email,
            name: row.name,
          });
          updated++;
        } else {
          batch.set(ref, {
            prn: row.prn,
            email: row.email,
            name: row.name,
            claimedByUid: null,
          });
          added++;
        }
      }

      await batch.commit();
    }

    return apiSuccess({
      added,
      updated,
      rejected: invalidRows.length,
      invalidRows,
      totalProcessed: validRows.length + invalidRows.length,
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to process eligibility upload", 500);
  }
}
