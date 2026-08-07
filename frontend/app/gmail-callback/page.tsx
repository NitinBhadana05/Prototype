import { Suspense } from "react";
import GmailCallbackInner from "./CallbackInner";

export default function GmailCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500"></div>
        </div>
      }
    >
      <GmailCallbackInner />
    </Suspense>
  );
}
