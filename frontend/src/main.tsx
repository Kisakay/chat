import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "./index.css";
import { App } from "./App.tsx";

/**
 * Lock page zoom app-wide (viewport meta + CSS touch-action cover most
 * browsers; these listeners catch the rest):
 * - iOS Safari ignores `user-scalable=no`, so `gesturestart` is cancelled.
 * - Desktop: Ctrl+wheel (incl. trackpad pinch) and Ctrl + +/-/0 are blocked.
 */
function useZoomLock() {
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "+" || e.key === "-" || e.key === "=" || e.key === "0")) {
        e.preventDefault();
      }
    };
    document.addEventListener("gesturestart", stop);
    document.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
}

function Root() {
  useZoomLock();
  return (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Root />);
