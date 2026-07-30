"use client";

import { Suspense } from "react";
import HubspotCallbackInner from "./CallbackInner";

export default function HubspotCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
          <p className="text-gray-500">Loading...</p>
        </div>
      }
    >
      <HubspotCallbackInner />
    </Suspense>
  );
}
