import { NextRequest } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { SeriesCreateSchema } from "@/lib/validate";
import { getNowInTimezone } from "@/lib/time";
import { Series, Test } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAdmin(req);
    if ("errorResponse" in authResult) {
      return authResult.errorResponse;
    }

    const snapshot = await adminDb
      .collection("series")
      .orderBy("createdAt", "desc")
      .get();

    const seriesList: Series[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<Series, "id">),
    }));

    return apiSuccess({ series: seriesList });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch series list", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAdmin(req);
    if ("errorResponse" in authResult) {
      return authResult.errorResponse;
    }

    const body = await req.json().catch(() => ({}));
    const parseResult = SeriesCreateSchema.safeParse(body);

    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      return apiError(`Validation failed: ${issue.message} (${issue.path.join(".")})`, 400);
    }

    const data = parseResult.data;
    const nowIso = new Date().toISOString();
    const { dateStr: todayDate } = getNowInTimezone(data.window.tz);
    const startDate = data.startDate || todayDate;

    // Create series doc ref
    const seriesRef = adminDb.collection("series").doc();
    const seriesId = seriesRef.id;

    const newSeries: Omit<Series, "id"> = {
      title: data.title,
      status: "draft",
      window: {
        start: data.window.start,
        end: data.window.end,
        tz: data.window.tz,
      },
      durationMin: data.durationMin,
      maxStrikes: data.maxStrikes,
      devtoolsOpenPolicy: data.devtoolsOpenPolicy,
      cameraStrikes: data.cameraStrikes ?? true,
      secondaryCameraRequired: data.secondaryCameraRequired ?? true,
      resultsVisible: data.resultsVisible,
      leaderboardVisible: data.leaderboardVisible,
      createdAt: nowIso,
      archivedAt: null,
    };

    // Calculate dates for the 5 tests
    const defaultCompanies = [
      "TCS (Ninja / Digital)",
      "Cognizant (GenC / Elevate)",
      "Infosys (DSE / SP)",
      "Accenture (ASE / FSE)",
      "Capgemini (Analyst)",
    ];

    const batch = adminDb.batch();
    batch.set(seriesRef, newSeries);

    const createdTests: Test[] = [];
    const baseDate = new Date(`${startDate}T12:00:00Z`);

    const daysCount = data.daysCount || 5;

    for (let day = 1; day <= daysCount; day++) {
      const testRef = adminDb.collection("tests").doc();
      const testDate = new Date(baseDate.getTime() + (day - 1) * 24 * 60 * 60 * 1000);
      const testDateStr = testDate.toISOString().split("T")[0];

      const testData: Omit<Test, "id"> = {
        seriesId,
        day,
        title: `Day ${day} Placement Test`,
        company:
          defaultCompanies[(day - 1) % defaultCompanies.length] ||
          "Company Assessment",
        date: testDateStr,
        window: null,
        durationMin: null,
        questionCount: 0,
        resultsVisible: null,
        secondaryCameraRequired: null,
        hasQuestions: false,
      };

      batch.set(testRef, testData);
      createdTests.push({ id: testRef.id, ...testData });
    }

    await batch.commit();

    return apiSuccess({
      series: { id: seriesId, ...newSeries },
      tests: createdTests,
    }, 201);
  } catch (error: any) {
    return apiError(error?.message || "Failed to create series", 500);
  }
}
