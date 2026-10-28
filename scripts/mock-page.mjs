import fs from "node:fs";
import path from "node:path";

const ENTRY = /<script type="module" src="\/src\/main\.ts"><\/script>/;

/** Serve /mock/index.html as the real index.html with the entry script
 * replaced by the mocked-backend harness. Generating it on demand keeps one
 * source of truth for the markup: a committed copy would drift. */
export function mockPage() {
  return {
    name: "rustbox-mock-page",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = (request.url ?? "").split("?")[0];
        if (url !== "/mock/index.html") {
          next();
          return;
        }
        const file = path.resolve(server.config.root, "index.html");
        const source = fs.readFileSync(file, "utf8");
        if (!ENTRY.test(source)) {
          response.statusCode = 500;
          response.end("index.html no longer has the expected module script.");
          return;
        }
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(
          source
            .replace("<title>Rustbox</title>", "<title>Rustbox (mocked backend)</title>")
            .replace(ENTRY, '<script type="module" src="/mock/backend.mjs"></script>'),
        );
      });
    },
  };
}
