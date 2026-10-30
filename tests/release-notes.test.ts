import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "../src/i18n";
import { httpUrl, renderReleaseNotes } from "../src/release-notes";

const CHANGELOG = `## [0.8.0](https://github.com/ifigueroap/rustbox/compare/v0.7.0...v0.8.0) (2026-10-30)

### Features

* add English and Spanish localization ([#26](https://github.com/ifigueroap/rustbox/issues/26)) ([de472f0](https://github.com/ifigueroap/rustbox/commit/de472f0705673e5f57a52f0cc59c))

### Bug Fixes

* replace native confirms ([#25](https://github.com/ifigueroap/rustbox/issues/25)) ([9f1c918](https://github.com/ifigueroap/rustbox/commit/9f1c91826f966b1af38f245a56d3))
`;

function render(markdown: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderReleaseNotes(markdown);
  return root;
}

afterEach(() => {
  setLocale("en");
});

describe("renderReleaseNotes", () => {
  it("renders headings, lists, emphasis, and code", () => {
    const root = render("## Title\n\n### Features\n\n* a **bold** item with `code`\n* second\n");
    expect(root.querySelector("h2")?.textContent).toBe("Title");
    expect(root.querySelector("h3")?.textContent).toBe("Features");
    const items = [...root.querySelectorAll("li")].map((item) => item.textContent);
    expect(items).toEqual(["a bold item with code", "second"]);
    expect(root.querySelector("strong")?.textContent).toBe("bold");
    expect(root.querySelector("code")?.textContent).toBe("code");
    expect(root.querySelector("ul")).not.toBeNull();
  });

  it("strips script tags and inline event handlers", () => {
    const root = render(
      'Hello <script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n<a href="https://example.com" onclick="alert(1)">site</a>',
    );
    expect(root.querySelector("script, img, a")).toBeNull();
    expect(root.querySelector("[onclick], [onerror], [onmouseover]")).toBeNull();
    expect(root.innerHTML.toLowerCase()).not.toMatch(/<\s*script/);
    expect(root.textContent).toContain("Hello");
    expect(root.textContent).toContain("alert(1)");
  });

  it("drops javascript and other non-http links and keeps the label", () => {
    const root = render(
      [
        "[click](javascript:alert(1))",
        "[also](JAVASCRIPT:alert(1))",
        "[data](data:text/html,<script>alert(1)</script>)",
        "[mail](mailto:someone@example.com)",
        "[ok](https://example.com/release)",
        "[plain](http://example.com/notes)",
      ].join("\n\n"),
    );
    const hrefs = [...root.querySelectorAll("a")].map((anchor) => anchor.getAttribute("href"));
    expect(hrefs).toEqual(["https://example.com/release", "http://example.com/notes"]);
    expect(root.innerHTML.toLowerCase()).not.toContain("javascript:");
    expect(root.innerHTML.toLowerCase()).not.toContain("data:");
    expect(root.innerHTML.toLowerCase()).not.toContain("mailto:");
    expect(root.textContent).toContain("click");
    expect(root.textContent).toContain("also");
    expect(root.textContent).toContain("data");
    expect(root.textContent).toContain("mail");
  });

  it("keeps the pull request link and drops the commit hash link", () => {
    setLocale("en");
    const root = render(CHANGELOG);
    const hrefs = [...root.querySelectorAll("a")].map((anchor) => anchor.getAttribute("href"));
    expect(hrefs).toContain("https://github.com/ifigueroap/rustbox/issues/26");
    expect(hrefs).toContain("https://github.com/ifigueroap/rustbox/issues/25");
    expect(hrefs?.some((href) => href?.includes("/commit/"))).toBe(false);
    expect(root.textContent).not.toContain("de472f0");
    expect(root.textContent).not.toContain("9f1c918");
    expect(root.querySelector("h2")?.textContent).toContain("0.8.0");
    expect(root.querySelector("h2 time.release-date")?.textContent).toBe("Oct 30, 2026");
    expect(root.querySelector("h2 time")?.getAttribute("datetime")).toBe("2026-10-30");
    expect(root.querySelector("h3")?.textContent).toBe("Features");
    expect(root.querySelectorAll("li")).toHaveLength(2);
  });

  it("formats the heading date for the Spanish UI", () => {
    setLocale("es");
    const root = render("## [0.8.0](https://example.com/compare/v0.7.0...v0.8.0) (2026-10-30)\n");
    expect(root.querySelector("time.release-date")?.textContent).toBe("30 oct 2026");
    expect(root.textContent).not.toContain("(2026-10-30)");
  });

  it("leaves an impossible heading date as text", () => {
    const root = render("## Shipped (2026-13-40)\n");
    expect(root.querySelector("time")).toBeNull();
    expect(root.querySelector("h2")?.textContent).toContain("(2026-13-40)");
  });
});

describe("httpUrl", () => {
  it("accepts only absolute http and https URLs", () => {
    expect(httpUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(httpUrl("  http://example.com/b  ")).toBe("http://example.com/b");
    expect(httpUrl("javascript:alert(1)")).toBeNull();
    expect(httpUrl("JavaScript:alert(1)")).toBeNull();
    expect(httpUrl("data:text/html,hi")).toBeNull();
    expect(httpUrl("mailto:a@b.c")).toBeNull();
    expect(httpUrl("/relative")).toBeNull();
    expect(httpUrl("https://ex\nample.com")).toBeNull();
    expect(httpUrl("")).toBeNull();
    expect(httpUrl(null)).toBeNull();
  });
});
