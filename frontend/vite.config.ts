import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Build directly into the backend's static dir (single-origin deploy).
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Object form needed for ws:true — access-request live updates ride
      // a WebSocket under /api (proxied in dev, same-origin in prod).
      "/api": { target: "http://localhost:3000", ws: true },
    },
  },
});
