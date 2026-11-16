import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertBinPkgbuild,
  assertPkgbuild,
  BIN_PKGBUILD_PATH,
  fetchTarballSha256,
  PKGBUILD_PATH,
  renderPkgbuild,
  sha256,
  tagTarballUrl,
} from "../scripts/render-arch-pkgbuild.mjs";

const template = fs.readFileSync(path.resolve(process.cwd(), PKGBUILD_PATH), "utf8");
const binTemplate = fs.readFileSync(path.resolve(process.cwd(), BIN_PKGBUILD_PATH), "utf8");
const DIGEST = "b".repeat(64);

describe("Arch PKGBUILD rendering", () => {
  it("renders the current app version", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));
    expect(template).toContain(`pkgver=${pkg.version} # x-release-please-version`);
    expect(() => assertPkgbuild(template, { version: pkg.version })).not.toThrow();
  });

  it("ships the recipe the release job rewrites", () => {
    expect(template).toContain("pkgname=rustbox");
    expect(template).toContain("arch=(x86_64)");
    expect(template).toContain("license=(MIT)");
    expect(template).toContain("pkgrel=1");
    expect(template).toContain("/archive/refs/tags/v$pkgver.tar.gz");
    expect(template).toContain("x-release-please-version");
    expect(template).toContain("conflicts=(rustbox-bin)");
    expect(template).toContain("packaging/arch/rustbox.desktop");
  });

  it("names the dependency set the app actually links", () => {
    for (const dep of [
      "webkit2gtk-4.1",
      "gtk3",
      "libayatana-appindicator",
      "xdg-utils",
      // WebKitGTK asks GStreamer for `autoaudiosink` the first time a page
      // plays audio and aborts in WebKitWebProcess when the plugin is missing,
      // so the plugins that provide it are runtime dependencies, not extras.
      "gst-plugins-base",
      "gst-plugins-good",
    ]) {
      expect(template).toMatch(new RegExp(`^\\s+${dep.replace(/[.+]/g, "\\$&")}$`, "m"));
    }
    for (const dep of ["rust", "nodejs", "npm", "pkgconf"]) {
      expect(template).toMatch(new RegExp(`^\\s+${dep}$`, "m"));
    }
    // `cargo` is provided by `rust`; naming both would break makepkg -s.
    expect(template).not.toMatch(/^\s+cargo$/m);
    expect(template).not.toMatch(/^\s+git$/m);
  });

  it("offers the extra GStreamer codec sets without requiring them", () => {
    const optdepends = template.match(/^optdepends=\(\n([\s\S]*?)^\)$/m)?.[1] ?? "";
    for (const dep of ["gst-plugins-bad", "libnice", "gst-plugin-pipewire", "gst-libav", "geoclue", "xdg-desktop-portal", "pipewire"]) {
      // `name: description` is the makepkg form pacman shows next to the
      // package, so each entry has to carry a reason.
      expect(optdepends).toMatch(
        new RegExp(`^\\s+'${dep.replace(/[.+]/g, "\\$&")}: \\S.+',?$`, "m"),
      );
    }
    // Optional, not mandatory: they add codecs, and the audio path above works
    // without them.
    const depends = template.match(/^depends=\(\n([\s\S]*?)^\)$/m)?.[1] ?? "";
    expect(depends).not.toContain("gst-plugins-bad");
    expect(depends).not.toContain("gst-libav");
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
    // Dropping the GStreamer plugin sets brings back the WebKitWebProcess
    // abort on the first page that plays audio.
    const withoutAudio = template.replace(/^\s+gst-plugins-good\n/m, "");
    expect(() => assertPkgbuild(withoutAudio, { version: "0.9.1" })).toThrow(/gst-plugins-good/);
    const withoutOptdepends = template.replace(/^optdepends=\([\s\S]*?^\)\n/m, "");
    expect(() => assertPkgbuild(withoutOptdepends, { version: "0.9.1" })).toThrow(/optdepends/);
    const withoutBuild = template.replace(/^build\(\)/m, "prepare()");
    expect(() => assertPkgbuild(withoutBuild, { version: "0.9.1" })).toThrow(/build\(\)/);
    expect(() => assertPkgbuild(template, { version: "9.9.9" })).toThrow(/does not match/);
  });

  it("renders the prebuilt recipe from the same runtime dependencies", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));
    expect(binTemplate).toContain(`pkgver=${pkg.version} # x-release-please-version`);
    expect(() => assertBinPkgbuild(binTemplate, { version: pkg.version })).not.toThrow();
    expect(binTemplate).toContain("pkgname=rustbox-bin");
    expect(binTemplate).toContain("provides=(rustbox)");
    expect(binTemplate).toContain("conflicts=(rustbox)");
    expect(binTemplate).toContain(
      "/releases/download/v$pkgver/rustbox-linux-x64-bin.tar.gz",
    );
    expect(binTemplate).toContain('"$pkgdir/usr/bin/rustbox"');
    expect(binTemplate).toContain('"$pkgdir/usr/share/applications/rustbox.desktop"');
    expect(binTemplate).not.toMatch(/^build\(\)/m);
    expect(binTemplate).not.toMatch(/^makedepends=\(/m);

    const block = (text: string, name: string) => text.match(new RegExp(`^${name}=\\(\\n([\\s\\S]*?)\\n\\)`, "m"))?.[1];
    expect(block(binTemplate, "depends")).toBe(block(template, "depends"));
    expect(block(binTemplate, "optdepends")).toBe(block(template, "optdepends"));
  });

  it("stamps the prebuilt tarball checksum without compiling", () => {
    const digest = "c".repeat(64);
    const rendered = renderPkgbuild(binTemplate, { version: "v1.2.3", sha256: digest });
    expect(rendered).toContain("pkgver=1.2.3 # x-release-please-version");
    expect(rendered).toContain(`sha256sums=('${digest}')`);
    expect(rendered).toContain("rustbox-linux-x64-bin.tar.gz");
    assertBinPkgbuild(rendered, { version: "1.2.3" });
    const strip = (text: string) =>
      text.split("\n").filter((line) => !/^pkgver=|^pkgrel=|^sha256sums=/.test(line));
    expect(strip(rendered)).toEqual(strip(binTemplate));
  });

  it("rejects a prebuilt recipe that compiles or drops the install layout", () => {
    expect(() => assertBinPkgbuild(binTemplate, { version: "9.9.9" })).toThrow(/does not match/);
    const compiling = `${binTemplate}\nbuild() {\n  npm ci\n}\n`;
    expect(() => assertBinPkgbuild(compiling, { version: "0.15.1" })).toThrow(/build\(\)|compiles/);
    const noIcon = binTemplate.replace("/usr/share/icons/hicolor/256x256/apps/rustbox.png", "/tmp/elsewhere.png");
    expect(() => assertBinPkgbuild(noIcon, { version: "0.15.1" })).toThrow(/icon 256x256/);
  });

  it("packs the release binary with the shared desktop file and hicolor icons", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rustbox-bin-"));
    const binary = path.join(dir, "rustbox");
    fs.writeFileSync(binary, "#!/bin/sh\necho rustbox\n", { mode: 0o755 });
    const out = path.join(dir, "rustbox-linux-x64-bin.tar.gz");
    execFileSync("bash", ["scripts/package-linux-bin-tarball.sh", binary, out], {
      cwd: process.cwd(),
    });
    const listing = execFileSync("tar", ["-tzf", out], { encoding: "utf8" });
    for (const entry of [
      "rustbox-linux-x64/rustbox",
      "rustbox-linux-x64/LICENSE",
      "rustbox-linux-x64/rustbox.desktop",
      "rustbox-linux-x64/icons/hicolor/32x32/apps/rustbox.png",
      "rustbox-linux-x64/icons/hicolor/64x64/apps/rustbox.png",
      "rustbox-linux-x64/icons/hicolor/128x128/apps/rustbox.png",
      "rustbox-linux-x64/icons/hicolor/256x256/apps/rustbox.png",
      "rustbox-linux-x64/icons/hicolor/512x512/apps/rustbox.png",
    ]) {
      expect(listing.split("\n")).toContain(entry);
    }
    const desktop = execFileSync("tar", ["-xOzf", out, "rustbox-linux-x64/rustbox.desktop"], {
      encoding: "utf8",
    });
    expect(desktop).toBe(fs.readFileSync("packaging/arch/rustbox.desktop", "utf8"));
    const icon = execFileSync("tar", ["-xOzf", out, "rustbox-linux-x64/icons/hicolor/32x32/apps/rustbox.png"]);
    expect(Buffer.compare(icon, fs.readFileSync("src-tauri/icons/32x32.png"))).toBe(0);
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
