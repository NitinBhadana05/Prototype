"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle2, AlertCircle, ArrowLeft, Loader2 } from "lucide-react";

export default function CallbackInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const hs_connected = searchParams.get("hs_connected");
    const hs_error = searchParams.get("hs_error");

    if (hs_connected === "1") {
      setStatus("success");
      if (window.opener) {
        try {
          window.opener.postMessage({ type: "hs_connected" }, window.location.origin);
          setTimeout(() => {
            window.close();
          }, 800);
        } catch {
          // ignore popup closure errors
        }
      }
    } else {
      setStatus("error");
      const err = hs_error || "unknown_error";
      setErrorMessage(err);
      if (window.opener) {
        try {
          window.opener.postMessage({ type: "hs_error", error: err }, window.location.origin);
          setTimeout(() => {
            window.close();
          }, 1500);
        } catch {
          // ignore popup closure errors
        }
      }
    }
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-8 text-center animate-fade-in">
        {status === "processing" && (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 text-[#ff7a59] animate-spin" />
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Connecting to HubSpot...</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Completing authentication, please wait.</p>
          </div>
        )}

        {status === "success" && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">HubSpot Connected!</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Your HubSpot account has been successfully linked. Custom properties and stage mappings are ready.
            </p>
            <button
              onClick={() => {
                if (window.opener) {
                  window.close();
                } else {
                  router.push("/");
                }
              }}
              className="mt-4 inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-[#ff7a59] hover:bg-[#e5694d] text-white text-sm font-semibold rounded-xl transition-all shadow-md hover:shadow-lg"
            >
              <ArrowLeft className="w-4 h-4" />
              Return to Dashboard
            </button>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
              <AlertCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Connection Failed</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {errorMessage ? `Error: ${errorMessage}` : "Could not complete HubSpot authorization."}
            </p>
            <button
              onClick={() => {
                if (window.opener) {
                  window.close();
                } else {
                  router.push("/");
                }
              }}
              className="mt-4 inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-gray-800 hover:bg-gray-900 text-white text-sm font-semibold rounded-xl transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              Return to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
