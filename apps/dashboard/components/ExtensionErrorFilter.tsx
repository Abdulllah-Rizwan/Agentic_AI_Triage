"use client";

import { useEffect } from "react";

/**
 * Suppresses unhandled-rejection errors thrown by browser extensions
 * (MetaMask, etc.) so they don't pollute the Next.js dev error overlay.
 */
export function ExtensionErrorFilter() {
  useEffect(() => {
    const handle = (e: PromiseRejectionEvent) => {
      const stack: string = e.reason?.stack ?? e.reason?.toString() ?? "";
      if (
        stack.includes("chrome-extension://") ||
        stack.includes("moz-extension://") ||
        stack.includes("safari-extension://")
      ) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", handle);
    return () => window.removeEventListener("unhandledrejection", handle);
  }, []);
  return null;
}
