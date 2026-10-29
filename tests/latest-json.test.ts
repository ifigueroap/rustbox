import { describe, expect, it } from "vitest";

import { assertLatestJson, buildLatestJson, selfTest } from "../scripts/generate-latest-json.mjs";

describe("latest.json", () => {
  it("points every platform at the stable release asset and shares the macOS archive", () => {
    const manifest = buildLatestJson({
      version: "v0.6.0",
      notes: "Hello\n",
      pubDate: "2026-10-29T01:00:00Z",
      signatures: {
        windows: " windows sig \n",
        linux: "linux sig",
        macos: "mac sig",
      },
      repo: "ifigueroap/rustbox",
      tag: "v0.6.0",
    });
    assertLatestJson(manifest);
    expect(manifest.version).toBe("0.6.0");
    expect(manifest.notes).toBe("Hello");
    expect(manifest.platforms["windows-x86_64"]).toEqual({
      signature: "windows sig",
      url: "https://github.com/ifigueroap/rustbox/releases/download/v0.6.0/rustbox-windows-x64-setup.exe",
    });
    expect(manifest.platforms["linux-x86_64"].url).toBe(
      "https://github.com/ifigueroap/rustbox/releases/download/v0.6.0/rustbox-linux-x64.AppImage",
    );
    expect(manifest.platforms["darwin-aarch64"]).toEqual(manifest.platforms["darwin-x86_64"]);
    expect(manifest.platforms["darwin-x86_64"].url).toContain("rustbox-macos-universal.app.tar.gz");
    expect(JSON.stringify(manifest)).not.toContain("rustbox-windows-x64.exe");
    expect(JSON.stringify(manifest)).not.toContain("rustbox-linux-x64.tar.gz");
  });

  it("refuses a partial manifest", () => {
    expect(() =>
      buildLatestJson({
        version: "0.6.0",
        notes: "",
        pubDate: "2026-10-29T01:00:00Z",
        signatures: { windows: "win", linux: "linux", macos: "" },
        repo: "ifigueroap/rustbox",
      }),
    ).toThrow(/macos signature/);
    expect(() => selfTest()).not.toThrow();
  });
});
