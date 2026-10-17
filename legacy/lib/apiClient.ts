import { auth } from "./firebase-client";
import { ApiResponse } from "@/types";

export interface RequestOptions extends Omit<RequestInit, "body"> {
  params?: Record<string, string | number | boolean | undefined>;
}

export class ApiError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

async function request<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});

  // Ensure Firebase Auth has finished restoring state from storage on page reload/Ctrl+R
  if (!auth.currentUser && typeof auth.authStateReady === "function") {
    try {
      await auth.authStateReady();
    } catch {
      // Proceed if auth state check fails
    }
  }

  // Attach Firebase ID token if user is signed in
  if (auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
    } catch {
      // Failed to get token, proceed without it
    }
  }

  // Set default JSON Content-Type if not sending FormData
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  let envelope: ApiResponse<T>;
  try {
    envelope = await response.json();
  } catch {
    throw new ApiError(
      `Invalid response from server (${response.status} ${response.statusText})`,
      response.status
    );
  }

  if (!envelope.success) {
    throw new ApiError(envelope.error || "An unknown error occurred", response.status);
  }

  return envelope.data as T;
}

function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return path;
  const searchParams = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null) {
      searchParams.append(key, String(val));
    }
  }
  const queryString = searchParams.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export const apiClient = {
  get<T>(url: string, options?: RequestOptions): Promise<T> {
    const fullUrl = buildUrl(url, options?.params);
    return request<T>(fullUrl, { ...options, method: "GET" });
  },

  post<T>(url: string, body?: any, options?: RequestOptions): Promise<T> {
    const fullUrl = buildUrl(url, options?.params);
    const isFormData = body instanceof FormData;
    return request<T>(fullUrl, {
      ...options,
      method: "POST",
      body: isFormData ? body : JSON.stringify(body ?? {}),
    });
  },

  put<T>(url: string, body?: any, options?: RequestOptions): Promise<T> {
    const fullUrl = buildUrl(url, options?.params);
    const isFormData = body instanceof FormData;
    return request<T>(fullUrl, {
      ...options,
      method: "PUT",
      body: isFormData ? body : JSON.stringify(body ?? {}),
    });
  },

  patch<T>(url: string, body?: any, options?: RequestOptions): Promise<T> {
    const fullUrl = buildUrl(url, options?.params);
    const isFormData = body instanceof FormData;
    return request<T>(fullUrl, {
      ...options,
      method: "PATCH",
      body: isFormData ? body : JSON.stringify(body ?? {}),
    });
  },

  delete<T>(url: string, body?: any, options?: RequestOptions): Promise<T> {
    const fullUrl = buildUrl(url, options?.params);
    const isFormData = body instanceof FormData;
    const hasBody = body !== undefined && body !== null;
    return request<T>(fullUrl, {
      ...options,
      method: "DELETE",
      ...(hasBody
        ? { body: isFormData ? body : JSON.stringify(body) }
        : {}),
    });
  },

  upload<T>(url: string, formData: FormData, options?: RequestOptions): Promise<T> {
    const fullUrl = buildUrl(url, options?.params);
    return request<T>(fullUrl, {
      ...options,
      method: "POST",
      body: formData,
    });
  },
};
