import { NextResponse } from "next/server";
import { ApiResponse } from "@/types";

export function apiSuccess<T>(data: T, status = 200) {
  const body: ApiResponse<T> = {
    success: true,
    data,
    error: null,
  };
  return NextResponse.json(body, { status });
}

export function apiError(message: string, status = 400) {
  const body: ApiResponse<null> = {
    success: false,
    data: null,
    error: message,
  };
  return NextResponse.json(body, { status });
}
