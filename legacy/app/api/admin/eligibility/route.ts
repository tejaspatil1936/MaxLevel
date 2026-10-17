import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { EligibleUser } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAdmin(req);
    if ("errorResponse" in authResult) {
      return authResult.errorResponse;
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.toLowerCase().trim() || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSizeParam = searchParams.get("pageSize") || searchParams.get("limit") || "50";
    const status = searchParams.get("status") || "all"; // 'all' | 'claimed' | 'unclaimed'
    const sortBy = searchParams.get("sortBy") || "prn"; // 'prn' | 'name' | 'email' | 'status'
    const sortOrder = searchParams.get("sortOrder") === "desc" ? "desc" : "asc";

    const isAll = pageSizeParam.toLowerCase() === "all" || pageSizeParam === "-1";
    const pageSize = isAll ? 10000 : Math.max(1, Math.min(500, parseInt(pageSizeParam, 10) || 50));

    // Fetch all documents from eligibleUsers
    const snapshot = await adminDb.collection("eligibleUsers").get();
    let allUsers: EligibleUser[] = snapshot.docs.map((doc) => doc.data() as EligibleUser);

    const totalCount = allUsers.length;
    const claimedCount = allUsers.filter((u) => Boolean(u.claimedByUid)).length;
    const unclaimedCount = totalCount - claimedCount;

    // Filter by status if requested
    if (status === "claimed") {
      allUsers = allUsers.filter((u) => Boolean(u.claimedByUid));
    } else if (status === "unclaimed") {
      allUsers = allUsers.filter((u) => !u.claimedByUid);
    }

    // Filter by search term across PRN, Name, and Email
    if (search) {
      allUsers = allUsers.filter(
        (u) =>
          (u.prn && u.prn.toLowerCase().includes(search)) ||
          (u.email && u.email.toLowerCase().includes(search)) ||
          (u.name && u.name.toLowerCase().includes(search))
      );
    }

    // Sort users
    allUsers.sort((a, b) => {
      let valA = "";
      let valB = "";
      if (sortBy === "name") {
        valA = a.name?.toLowerCase() || "";
        valB = b.name?.toLowerCase() || "";
      } else if (sortBy === "email") {
        valA = a.email?.toLowerCase() || "";
        valB = b.email?.toLowerCase() || "";
      } else if (sortBy === "status") {
        valA = a.claimedByUid ? "claimed" : "unclaimed";
        valB = b.claimedByUid ? "claimed" : "unclaimed";
      } else {
        valA = a.prn?.toLowerCase() || "";
        valB = b.prn?.toLowerCase() || "";
      }

      const cmp = valA.localeCompare(valB, undefined, { numeric: true });
      return sortOrder === "desc" ? -cmp : cmp;
    });

    const filteredCount = allUsers.length;
    const totalPages = isAll ? 1 : Math.max(1, Math.ceil(filteredCount / pageSize));
    const validPage = Math.min(page, totalPages);
    const startIndex = (validPage - 1) * pageSize;
    const paginatedUsers = isAll ? allUsers : allUsers.slice(startIndex, startIndex + pageSize);

    return apiSuccess({
      users: paginatedUsers,
      totalCount,
      claimedCount,
      unclaimedCount,
      filteredCount,
      page: validPage,
      pageSize: isAll ? filteredCount : pageSize,
      totalPages,
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch eligible users", 500);
  }
}


export async function DELETE(req: NextRequest) {
  try {
    const authResult = await requireAdmin(req);
    if ("errorResponse" in authResult) {
      return authResult.errorResponse;
    }

    const { searchParams } = new URL(req.url);
    const clearAll = searchParams.get("clearAll") === "true";
    const singlePrn = searchParams.get("prn");

    const body = await req.json().catch(() => ({}));
    const prnsToDelete: string[] = Array.isArray(body?.prns)
      ? body.prns
      : singlePrn
      ? [singlePrn]
      : [];

    if (clearAll) {
      let totalDeleted = 0;
      let hasMore = true;

      while (hasMore) {
        const snapshot = await adminDb
          .collection("eligibleUsers")
          .limit(400)
          .get();

        if (snapshot.empty) {
          hasMore = false;
          break;
        }

        const batch = adminDb.batch();
        snapshot.docs.forEach((doc) => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        totalDeleted += snapshot.size;

        if (snapshot.size < 400) {
          hasMore = false;
        }
      }

      return apiSuccess({
        message: `Successfully cleared all ${totalDeleted} eligibility records.`,
        deletedCount: totalDeleted,
      });
    }

    if (prnsToDelete.length > 0) {
      let deletedCount = 0;
      const CHUNK_SIZE = 30;

      for (let i = 0; i < prnsToDelete.length; i += CHUNK_SIZE) {
        const chunk = prnsToDelete.slice(i, i + CHUNK_SIZE);
        const snapshot = await adminDb
          .collection("eligibleUsers")
          .where("prn", "in", chunk)
          .get();

        const batch = adminDb.batch();
        const seenDocPaths = new Set<string>();

        snapshot.docs.forEach((doc) => {
          seenDocPaths.add(doc.ref.path);
          batch.delete(doc.ref);
          deletedCount++;
        });

        // Also check by direct docId / encoded docId fallback
        chunk.forEach((p) => {
          const trimmed = p.trim();
          if (trimmed) {
            const refEncoded = adminDb
              .collection("eligibleUsers")
              .doc(encodeURIComponent(trimmed));
            if (!seenDocPaths.has(refEncoded.path)) {
              batch.delete(refEncoded);
            }
            if (encodeURIComponent(trimmed) !== trimmed) {
              const refPlain = adminDb
                .collection("eligibleUsers")
                .doc(trimmed);
              if (!seenDocPaths.has(refPlain.path)) {
                batch.delete(refPlain);
              }
            }
          }
        });

        await batch.commit();
      }

      return apiSuccess({
        message: `Successfully removed ${prnsToDelete.length} student(s) from eligibility list.`,
        deletedCount: prnsToDelete.length,
      });
    }

    return apiError(
      "Specify ?clearAll=true or provide a list of prns to remove",
      400
    );
  } catch (error: any) {
    return apiError(error?.message || "Failed to remove eligible users", 500);
  }
}
