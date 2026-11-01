import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertPkgbuild,
  fetchTarballSha256,
  PKGBUILD_PATH,
  renderPkgbuild,
  sha256,
  tagTarballUrl,
} from "../scripts/render-arch-pkgbuild.mjs";

const template = fs.readFileSync(path.resolve(process.cwd(), PKGBUILD_PATH), "utf8");
const DIGEST = "b".repeat(64);

describe("Arch PKGBUILD rendering", () => {
  it("ships the recipe the release job rewrites", () => {
    expect(template).toContain("pkgname=rustbox");
    expect(template).toContain("pkgver=0.9.1 # x-release-please-version");
    expect(template).toContain("arch=(x86_64)");
    expect(template).toContain("license=(MIT)");
    expect(template).toContain("/archive/refs/tags/v$pkgver.tar.gz");
    expect(() => assertPkgbuild(template, { version: "0.9.1" })).not.toThrow();
  });

  it("names the dependency set the app actually links", () => {
    for (const dep of ["webkit2gtk-4.1", "gtk3", "libayatana-appindicator", "xdg-utils"]) {
      expect(template).toMatch(new RegExp(`^\\s+${dep.replace(/[.+]/g, "\\$&")}$`, "m"));
    }
    for (const dep of ["rust", "nodejs", "npm", "pkgconf"]) {
      expect(template).toMatch(new RegExp(`^\\s+${dep}$`, "m"));
    }
    // `cargo` is provided by `rust`; naming both would break makepkg -s.
    expect(template).not.toMatch(/^\s+cargo$/m);
    expect(template).not.toMatch(/^\s+git$/m);
  });

  it("builds without bundling an AppImage or needing the signing key", () => {
    expect(template).toContain("--no-bundle");
    expect(template).toContain('{"bundle":{"createUpdaterArtifacts":false}}');
    // The name may appear in a comment explaining why it is not needed; it
    // must never be read or exported.
    expect(template).not.toMatch(/^\s*(export\s+)?TAURI_SIGNING_PRIVATE_KEY=/m);
    expect(template).toContain("npm ci");
    // The frontend build runs inside `tauri build` so dist/ is embedded.
    expect(template).not.toMatch(/^\s+npm run build$/m);
  });

  it("rewrites the version, resets pkgrel, and stamps the tag tarball checksum", () => {
    const rendered = renderPkgbuild(template, { version: "v1.2.3", sha256: DIGEST });
    expect(rendered).toContain("pkgver=1.2.3 # x-release-please-version");
    expect(rendered).toContain("pkgrel=1");
    expect(rendered).toContain(`sha256sums=('${DIGEST}')`);
    expect(rendered).not.toContain("0.9.1");
    // The marker Release Please rewrites survives the render.
    expect(rendered).not.toContain("x-release-please-version #");
    assertPkgbuild(rendered, { version: "1.2.3" });
  });

  it("keeps everything but the three rewritten lines", () => {
    const rendered = renderPkgbuild(template, { version: "1.2.3", sha256: DIGEST });
    const strip = (text: string) =>
      text
        .split("\n")
        .filter((line) => !/^pkgver=|^pkgrel=|^sha256sums=/.test(line));
    expect(strip(rendered)).toEqual(strip(template));
  });

  it("refuses a version or checksum that makepkg cannot use", () => {
    expect(() => renderPkgbuild(template, { version: "1.2", sha256: DIGEST })).toThrow(/semver/);
    expect(() => renderPkgbuild(template, { version: "1.2.3", sha256: "abc" })).toThrow(/sha256/);
    expect(() => renderPkgbuild(template, { version: "1.2.3", sha256: DIGEST, pkgrel: 0 })).toThrow(
      /pkgrel/,
    );
  });

  it("rejects a recipe that drops a dependency or a build step", () => {
    const withoutWebkit = template.replace(/^\s+webkit2gtk-4\.1\n/m, "");
    expect(() => assertPkgbuild(withoutWebkit, { version: "0.9.1" })).toThrow(/webkit2gtk/);
    const withoutBuild = template.replace(/^build\(\)/m, "prepare()");
    expect(() => assertPkgbuild(withoutBuild, { version: "0.9.1" })).toThrow(/build\(\)/);
    expect(() => assertPkgbuild(template, { version: "9.9.9" })).toThrow(/does not match/);
  });

  it("points the source at the GitHub tag tarball", () => {
    expect(tagTarballUrl("ifigueroap/rustbox", "0.9.1")).toBe(
      "https://github.com/ifigueroap/rustbox/archive/refs/tags/v0.9.1.tar.gz",
    );
    expect(tagTarballUrl("ifigueroap/rustbox", "v0.9.1")).toBe(
      "https://github.com/ifigueroap/rustbox/archive/refs/tags/v0.9.1.tar.gz",
    );
  });

  it("hashes the bytes it downloads", async () => {
    const body = Buffer.from("tarball bytes");
    const fetchImpl = async (url: string) => ({
      ok: url === "https://example.test/v1.tar.gz",
      status: url === "https://example.test/v1.tar.gz" ? 200 : 404,
      arrayBuffer: async () => body,
    });
    await expect(fetchTarballSha256("https://example.test/v1.tar.gz", fetchImpl)).resolves.toBe(
      sha256(body),
    );
    await expect(fetchTarballSha256("https://example.test/nope.tar.gz", fetchImpl)).rejects.toThrow(
      /HTTP 404/,
    );
  });
});
