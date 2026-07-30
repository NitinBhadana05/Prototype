"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function CallbackInner() {
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined" || !window.opener) return;

    const hs_connected = searchParams.get("hs_connected");
    const hs_error = searchParams.get("hs_error");

    if (hs_connected === "1") {
      window.opener.postMessage({ type: "hs_connected" }, window.location.origin);
    } else {
      window.opener.postMessage(
        { type: "hs_error", error: hs_error || "unknown_error" },
        window.location.origin
      );
    }
    window.close();
  }, [searchParams]);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "sans-serif" }}>
      <p style={{ color: "#555" }}>Connecting to HubSpot… please wait.</p>
    </div>
  );
}
