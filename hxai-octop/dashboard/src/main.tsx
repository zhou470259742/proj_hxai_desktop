// Must be the very first import so the beforeinstallprompt listener is
// registered synchronously before Chrome fires the event (which can happen
// before React mounts and useEffect runs).
import "./pwa-prompt";

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initI18n } from "./i18n";
import {
  clearChunkReloadFlag,
  installChunkLoadRecovery,
  isChunkLoadError,
  tryReloadOnStaleChunk,
} from "./utils/reloadOnStaleChunk";

if (typeof window !== "undefined") {
  // Recover from post-deploy stale hashed chunks (white screen → soft reload).
  installChunkLoadRecovery();

  const originalError = console.error;
  const originalWarn = console.warn;

  console.error = function (...args: unknown[]) {
    const msg = args[0]?.toString() || "";
    if (msg.includes(":first-child") || msg.includes("pseudo class")) {
      return;
    }
    originalError.apply(console, args);
  };

  console.warn = function (...args: unknown[]) {
    const msg = args[0]?.toString() || "";
    if (
      msg.includes(":first-child") ||
      msg.includes("pseudo class") ||
      msg.includes("potentially unsafe")
    ) {
      return;
    }
    originalWarn.apply(console, args);
  };

  // Catch unhandled Promise rejections (e.g. uncaught async errors)
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    // Chunk recovery (installChunkLoadRecovery) already handles these.
    if (isChunkLoadError(reason)) return;
    // Suppress common benign errors
    const msg = reason?.message || String(reason) || "";
    if (
      msg.includes("ResizeObserver") ||
      msg.includes("AbortError") ||
      msg.includes("The operation was aborted")
    ) {
      return;
    }
    console.error("[UnhandledRejection]", reason);
  });
}

void initI18n()
  .then(() => {
    createRoot(document.getElementById("root")!).render(<App />);
    // Delay clearing the one-shot reload guard until after first paint / lazy
    // chunks settle. Clearing immediately let Firefox modulepreload noise and
    // aborted dynamic imports re-arm an infinite reload loop.
    window.setTimeout(() => clearChunkReloadFlag(), 4000);
  })
  .catch((err: unknown) => {
    if (tryReloadOnStaleChunk(err)) return;
    console.error("[initI18n]", err);
  });

// Register SW as early as possible so beforeinstallprompt can fire before the
// user clicks the header install button (deferring to "load" caused a race).
// DEV clears stale production workers, then registers the notification worker.
if (typeof window !== "undefined") {
  void import("./sw-register").then(({ registerSW }) => registerSW());
}

// Floating reload button: vite dev, or inside the Wails webview which has no
// browser chrome regardless of build mode.
const inDesktopShell =
  typeof (window as unknown as { _wails?: unknown })._wails !== "undefined";
if ((import.meta.env.DEV || inDesktopShell) && typeof document !== "undefined") {
  const btn = document.createElement("button");
  btn.textContent = "↻";
  btn.title = "Reload (dev)";
  btn.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:99999;width:40px;height:40px;" +
    "border-radius:50%;border:1px solid rgba(0,0,0,.15);background:#1f2937;color:#fff;" +
    "font-size:20px;line-height:1;cursor:pointer;opacity:.8;transition:opacity .15s;box-shadow:0 2px 8px rgba(0,0,0,.25)";
  btn.onmouseenter = () => (btn.style.opacity = "1");
  btn.onmouseleave = () => (btn.style.opacity = ".8");
  btn.onclick = () => location.reload();
  document.body.appendChild(btn);
}
