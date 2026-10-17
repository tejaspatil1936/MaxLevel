import { adminAuth, adminDb } from "./firebase-admin";
import { apiError } from "./response";
import { UserProfile } from "@/types";

export function getAdminEmails(): string[] {
  const envAdmins = process.env.ADMIN_EMAILS || "";
  return envAdmins
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAdmin(email: string | undefined): boolean {
  if (!email) return false;
  const adminEmails = getAdminEmails();
  return adminEmails.includes(email.trim().toLowerCase());
}

export async function authenticateRequest(
  request: Request
): Promise<{ user: UserProfile } | { errorResponse: Response }> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      errorResponse: apiError("Missing or invalid Authorization header", 401),
    };
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return {
      errorResponse: apiError("Token not provided in Authorization header", 401),
    };
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;
    const email = (decodedToken.email || "").toLowerCase();

    // Fetch user doc from Firestore users/{uid}
    const userDocRef = adminDb.collection("users").doc(uid);
    const userDoc = await userDocRef.get();

    const isAdmin = isEmailAdmin(email);

    if (!userDoc.exists) {
      // If user doc doesn't exist yet but user is in ADMIN_EMAILS, bootstrap admin profile
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
        return { user: adminProfile };
      }

      return {
        errorResponse: apiError("User registration incomplete or unauthorized", 403),
      };
    }

    const userData = userDoc.data() as UserProfile;

    // Check if role should be upgraded to admin based on ADMIN_EMAILS
    if (isAdmin && userData.role !== "admin") {
      userData.role = "admin";
      await userDocRef.update({ role: "admin" });
    }

    return { user: userData };
  } catch (err: any) {
    return {
      errorResponse: apiError(
        err?.message || "Failed to authenticate token",
        401
      ),
    };
  }
}

/**
 * Guard for Student API routes:
 * Verifies ID token AND confirms users/{uid} exists with role "student" (admins are also allowed).
 * A valid Google token alone without a users/{uid} record is rejected.
 */
export async function requireStudent(
  request: Request
): Promise<{ user: UserProfile } | { errorResponse: Response }> {
  const authResult = await authenticateRequest(request);
  if ("errorResponse" in authResult) {
    return authResult;
  }

  if (authResult.user.role !== "student" && authResult.user.role !== "admin") {
    return {
      errorResponse: apiError("Student authorization required", 403),
    };
  }

  return authResult;
}

/**
 * Guard for Admin API routes:
 * Verifies ID token AND confirms users/{uid} exists with role "admin".
 */
export async function requireAdmin(
  request: Request
): Promise<{ user: UserProfile } | { errorResponse: Response }> {
  const authResult = await authenticateRequest(request);
  if ("errorResponse" in authResult) {
    return authResult;
  }

  if (authResult.user.role !== "admin") {
    return {
      errorResponse: apiError("Admin privileges required", 403),
    };
  }

  return authResult;
}
