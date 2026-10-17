"use client";

import { useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function ProctorPairRedirect() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const token = searchParams.get("token");
    const query = token ? `?token=${encodeURIComponent(token)}` : "";
    router.replace(`/proctor${query}`);
  }, [searchParams, router]);

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center font-mono text-sm">
      Redirecting to proctor companion...
    </div>
  );
}

export default function ProctorPairPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <ProctorPairRedirect />
    </Suspense>
  );
}
