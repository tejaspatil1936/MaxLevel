import { NextRequest } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isEmailAdmin } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/response";
import { UserProfile, EligibleUser } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return apiError("Missing Authorization header", 401);
    }

    const token = authHeader.substring(7).trim();
    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;
    const email = (decodedToken.email || "").toLowerCase();

    if (!email) {
      return apiError("Account does not provide an email address", 400);
    }

    // Server-enforced verification: email must be verified
    if (!decodedToken.email_verified) {
      return apiError("Google email address is not verified", 403);
    }

    const isAdmin = isEmailAdmin(email);
    const userDocRef = adminDb.collection("users").doc(uid);

    // If user record already exists, return profile immediately
    const existingUserDoc = await userDocRef.get();
    if (existingUserDoc.exists) {
      const existingUser = existingUserDoc.data() as UserProfile;
      if (isAdmin && existingUser.role !== "admin") {
        existingUser.role = "admin";
        await userDocRef.update({ role: "admin" });
      }
      return apiSuccess({ user: existingUser });
    }

    // Admin first sign-in
    if (isAdmin) {
      const adminProfile: UserProfile = {
        uid,
        prn: "ADMIN",
        email,
        name: decodedToken.name || "Administrator",
        role: "admin",
        createdAt: new Date().toISOString(),
      };
      await userDocRef.set(adminProfile);
      return apiSuccess({ user: adminProfile });
    }

    // Student first sign-in: match using verified token email ONLY
    const eligibleQuery = await adminDb
      .collection("eligibleUsers")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (eligibleQuery.empty) {
      // Create NO users doc if email is not on whitelist!
      return apiError(
        `The Google account (${email}) is not on the placement eligibility whitelist. Contact your T&P coordinator.`,
        403
      );
    }

    const eligibleDocRef = eligibleQuery.docs[0].ref;

    // Atomically claim the row and create users/{uid} in a Firestore transaction
    try {
      const studentProfile = await adminDb.runTransaction(async (transaction) => {
        const eligibleDoc = await transaction.get(eligibleDocRef);
        if (!eligibleDoc.exists) {
          throw new Error("Eligibility record not found");
        }

        const eligibleData = eligibleDoc.data() as EligibleUser;

        // A row already claimed by a different uid is rejected
        if (eligibleData.claimedByUid && eligibleData.claimedByUid !== uid) {
          throw new Error("This student record has already been claimed by another Google account");
        }

        const userDoc = await transaction.get(userDocRef);
        if (userDoc.exists) {
          return userDoc.data() as UserProfile;
        }

        // Claim the row in eligibleUsers
        transaction.update(eligibleDocRef, {
          claimedByUid: uid,
        });

        // Create users/{uid} document
        const newProfile: UserProfile = {
          uid,
          prn: eligibleData.prn,
          email: eligibleData.email,
          name: eligibleData.name || decodedToken.name || "Student",
          role: "student",
          createdAt: new Date().toISOString(),
        };

        transaction.set(userDocRef, newProfile);
        return newProfile;
      });

      return apiSuccess({ user: studentProfile });
    } catch (txError: any) {
      return apiError(txError?.message || "Failed to claim student record", 409);
    }
  } catch (error: any) {
    return apiError(error?.message || "Failed to complete registration", 500);
  }
}
