import fs from "node:fs";
import path from "node:path";

/** The real index.html, so a regression that depends on the static markup
 * (like the rail's `#workspace-list`) is exercised against what ships. */
export function shellHtml(): string {
  const html = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf8");
  // Drop the module script: jsdom does not run it, and the tests mount the
  // shell themselves through the exported API.
  return html.replace(/<script[^>]*src="\/src\/main\.ts"[^>]*><\/script>/, "");
}
