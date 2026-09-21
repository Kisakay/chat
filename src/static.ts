import { join } from "node:path";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export async function serveStatic(req: Request, url: URL): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("not found", { status: 404 });
  }
  let path = decodeURIComponent(url.pathname);
  if (path === "/") path = "/index.html";
  // block traversal
  if (path.includes("..") || path.includes("\0")) return new Response("not found", { status: 404 });
  const file = Bun.file(join(PUBLIC_DIR, path));
  if (!(await file.exists())) {
    // SPA fallback for non-API routes
    if (!path.startsWith("/api/")) {
      return new Response(Bun.file(join(PUBLIC_DIR, "index.html")));
    }
    return new Response("not found", { status: 404 });
  }
  const ext = path.slice(path.lastIndexOf("."));
  return new Response(file, {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": path === "/index.html" ? "no-cache" : "public, max-age=3600",
    },
  });
}
