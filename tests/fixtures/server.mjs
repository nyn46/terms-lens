// Test-only HTTP server for the fixture pages. The shipped extension never talks to it: Chrome reaches it
// through the host names fixtures.test and other.test (mapped by a test-only Chrome flag), so the extension's
// own "no localhost" rule is still checked literally.
import http from "node:http";
import { pages } from "./pages.mjs";

export function startFixtureServer() {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const name = new URL(request.url, "http://x").pathname.replace(/^\//, "") || "terms";
      const build = pages[name];
      if (!build) {
        response.writeHead(404).end("Not found");
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(build({ port: server.address().port }));
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, close: () => server.close() }));
  });
}
