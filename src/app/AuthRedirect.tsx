"use client";

// Globaler 401/HTML-Fangnetz: jede API-Antwort, die nicht JSON ist
// (Session abgelaufen, nie geloggt) → sofort zur Login-Seite.
import { useEffect } from "react";

export default function AuthRedirect() {
  useEffect(() => {
    const orig = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
      orig(input, init).then((r) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const ct = r.headers.get("content-type") || "";
        const isApi = url.startsWith("/api/") && !url.includes("/api/auth");
        if (isApi && (r.status === 401 || ct.includes("text/html"))) {
          window.location.href = "/login";
        }
        return r;
      });
  }, []);
  return null;
}
