#!/usr/bin/env node
// Render the Arch PKGBUILD that ships as a GitHub Release asset.
//
// `packaging/arch/PKGBUILD` is the source of truth for the recipe: its
// dependency lists, build steps, and file installation. Release Please keeps
// its `pkgver` and checksum in step with the app version, but a tag is the
// authority for what `makepkg` should download. This script rewrites `pkgver`,
// resets `pkgrel`, and recomputes `sha256sums` from the tag tarball, so the
// asset always names and checksums the tree that was released.
//
// The README's source install one-liner downloads that asset:
//
//   d=$(mktemp -d) && cd "$d" && \
//     curl -fsSLO https://github.com/ifigueroap/rustbox/releases/latest/download/PKGBUILD && \
//     makepkg -si
//
// `packaging/arch/rustbox-bin/PKGBUILD` is the prebuilt recipe. The same
// rewrite stamps it with the sha256 of `rustbox-linux-x64-bin.tar.gz`, and the
// Publish job uploads the result as `PKGBUILD-bin`. `--kind bin` selects that
// check; a template path containing `rustbox-bin` does too.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PKGBUILD_PATH = "packaging/arch/PKGBUILD";
export const BIN_PKGBUILD_PATH = "packaging/arch/rustbox-bin/PKGBUILD";
export const BIN_TARBALL = "rustbox-linux-x64-bin.tar.gz";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function tagTarballUrl(repo, version) {
  const clean = cleanVersion(version);
  return `https://github.com/${repo}/archive/refs/tags/v${clean}.tar.gz`;
}

function cleanVersion(version) {
  const clean = String(version ?? "").trim().replace(/^v/, "");
  if (!SEMVER.test(clean)) {
    throw new Error(`version must be semver, got ${version}`);
  }
  return clean;
}

function replaceOnce(content, pattern, replacement, what) {
  if (!pattern.test(content)) {
    throw new Error(`the PKGBUILD has no ${what} line to update`);
  }
  return content.replace(pattern, replacement);
}

/**
 * Rewrite `pkgver`, `pkgrel`, and `sha256sums` in `content`. Everything else,
 * including the `x-release-please-version` marker and the comments, is kept
 * byte for byte.
 */
export function renderPkgbuild(content, { version, sha256, pkgrel = 1 }) {
  const clean = cleanVersion(version);
  if (!/^[0-9a-f]{64}$/.test(String(sha256 ?? "").trim())) {
    throw new Error(`sha256 must be 64 lowercase hex characters, got ${sha256}`);
  }
  if (!Number.isInteger(pkgrel) || pkgrel < 1) {
    throw new Error(`pkgrel must be a positive integer, got ${pkgrel}`);
  }
  let next = replaceOnce(
    content,
    /^pkgver=.*$/m,
    `pkgver=${clean} # x-release-please-version`,
    "pkgver",
  );
  next = replaceOnce(next, /^pkgrel=.*$/m, `pkgrel=${pkgrel}`, "pkgrel");
  next = replaceOnce(
    next,
    /^sha256sums=\(.*\)$/m,
    `sha256sums=('${sha256.trim()}')`,
    "sha256sums",
  );
  return next;
}

function pkgbuildFields(content, problems) {
  const fields = {};
  for (const name of ["pkgname", "pkgver", "pkgrel", "arch", "license"]) {
    const match = content.match(new RegExp(`^${name}=(.*)$`, "m"));
    if (!match) problems.push(`missing ${name}`);
    else fields[name] = match[1].replace(/\s+#.*$/, "").replace(/^\(|\)$/g, "").trim();
  }
  return fields;
}

function assertShared(content, fields, version, problems) {
  if (fields.arch !== "x86_64") problems.push("arch");
  if (fields.license !== "MIT") problems.push("license");
  if (version !== undefined && fields.pkgver !== cleanVersion(version)) {
    problems.push(`pkgver ${fields.pkgver} does not match ${cleanVersion(version)}`);
  }
  if (!/^\d+$/.test(fields.pkgrel ?? "")) problems.push("pkgrel");
  if (!/^sha256sums=\('[0-9a-f]{64}'\)$/m.test(content)) problems.push("sha256sums");
  if (!/^package\(\)/m.test(content)) problems.push("package()");
  // WebKitGTK resolves its audio pipeline from GStreamer plugins at runtime and
  // aborts in WebKitWebProcess when `autoaudiosink` is missing, so the core
  // plugin sets are hard depends rather than optional extras.
  for (const bin of [
    "webkit2gtk-4.1",
    "gtk3",
    "libayatana-appindicator",
    "xdg-utils",
    "gst-plugins-base",
    "gst-plugins-good",
  ]) {
    if (!new RegExp(`^\\s+${bin.replace(/[.+]/g, "\\$&")}$`, "m").test(content)) {
      problems.push(`depends ${bin}`);
    }
  }
  if (!/^optdepends=\(/m.test(content)) problems.push("optdepends");
  for (const pkg of ["gst-plugins-bad", "libnice", "gst-plugin-pipewire", "gst-libav", "geoclue", "xdg-desktop-portal", "pipewire"]) {
    if (!new RegExp(`^\\s+'${pkg.replace(/[.+]/g, "\\$&")}: `, "m").test(content)) {
      problems.push(`optdepends ${pkg}`);
    }
  }
  if (/^(makedepends|depends)=\(.*\b(cargo|rustup)\b/m.test(content)) {
    problems.push("cargo is provided by rust, not named as a package");
  }
}

function finish(problems, content) {
  if (problems.length > 0) {
    throw new Error(`PKGBUILD is not ready: ${problems.join(", ")}`);
  }
  return content;
}

/** Problems that keep the rendered source PKGBUILD from being installable as-is. */
export function assertPkgbuild(content, { version } = {}) {
  const problems = [];
  const fields = pkgbuildFields(content, problems);
  if (fields.pkgname !== "rustbox") problems.push("pkgname");
  if (!/^conflicts=\(rustbox-bin\)$/m.test(content)) problems.push("conflicts rustbox-bin");
  assertShared(content, fields, version, problems);
  if (!content.includes("/archive/refs/tags/v$pkgver.tar.gz")) {
    problems.push("tag tarball source");
  }
  if (!/^build\(\)/m.test(content)) problems.push("build()");
  if (!content.includes("/usr/share/applications/rustbox.desktop")) problems.push("desktop");
  return finish(problems, content);
}

/**
 * Problems that keep the prebuilt PKGBUILD from installing the ubuntu binary
 * over the same paths as the source package.
 */
export function assertBinPkgbuild(content, { version } = {}) {
  const problems = [];
  const fields = pkgbuildFields(content, problems);
  if (fields.pkgname !== "rustbox-bin") problems.push("pkgname");
  if (!/^provides=\(rustbox\)$/m.test(content)) problems.push("provides");
  if (!/^conflicts=\(rustbox\)$/m.test(content)) problems.push("conflicts");
  assertShared(content, fields, version, problems);
  if (!content.includes(`/releases/download/v$pkgver/${BIN_TARBALL}`)) {
    problems.push("release asset source");
  }
  if (/^build\(\)/m.test(content)) problems.push("build()");
  if (/^makedepends=\(/m.test(content)) problems.push("makedepends");
  const code = content
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  if (/\bnpm ci\b|\btauri build\b|\bcargo\b/.test(code)) problems.push("compiles from source");
  if (!content.includes('"$pkgdir/usr/bin/rustbox"')) problems.push("binary path");
  if (!content.includes('"$pkgdir/usr/share/applications/rustbox.desktop"')) problems.push("desktop");
  for (const size of ["32x32", "64x64", "128x128", "256x256", "512x512"]) {
    if (!content.includes(`/usr/share/icons/hicolor/${size}/apps/rustbox.png`)) {
      problems.push(`icon ${size}`);
    }
  }
  return finish(problems, content);
}

export function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Download the tag tarball and return its digest. `fetchImpl` lets a test
 * answer without the network.
 */
export async function fetchTarballSha256(url, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`could not download ${url}: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return sha256(buffer);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = value;
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo ?? "ifigueroap/rustbox";
  const templatePath = path.resolve(args.template ?? PKGBUILD_PATH);
  const template = fs.readFileSync(templatePath, "utf8");

  if (args["self-test"]) {
    const rendered = renderPkgbuild(template, {
      version: "v9.8.7",
      sha256: "a".repeat(64),
    });
    assertPkgbuild(rendered, { version: "9.8.7" });
    if (!rendered.includes("pkgver=9.8.7 # x-release-please-version")) {
      throw new Error("the release-please marker was dropped");
    }
    const binTemplate = fs.readFileSync(path.resolve(BIN_PKGBUILD_PATH), "utf8");
    const binRendered = renderPkgbuild(binTemplate, {
      version: "v9.8.7",
      sha256: "b".repeat(64),
    });
    assertBinPkgbuild(binRendered, { version: "9.8.7" });
    if (!binRendered.includes("pkgver=9.8.7 # x-release-please-version")) {
      throw new Error("the bin release-please marker was dropped");
    }
    if (!binRendered.includes(`sha256sums=('${"b".repeat(64)}')`)) {
      throw new Error("the bin checksum was not written");
    }
    let rejected = false;
    try {
      renderPkgbuild(template, { version: "9.8.7", sha256: "nope" });
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("a bad checksum was accepted");
    console.log("PKGBUILD self-test ok");
    return;
  }

  const kind = recipeKind(args, templatePath);
  const check = kind === "bin" ? assertBinPkgbuild : assertPkgbuild;

  if (args["sha256-file"]) {
    // Offline path: the workflow already has the bytes (tag tarball, or the
    // linux bin archive produced by the build job).
    const version = args.version;
    const digest = sha256(fs.readFileSync(args["sha256-file"]));
    const rendered = renderPkgbuild(template, { version, sha256: digest });
    check(rendered, { version });
    write(rendered, args);
    return;
  }

  const version = args.version;
  if (!version) throw new Error("--version is required");
  const url = args.url ?? tagTarballUrl(repo, version);
  const digest = await fetchTarballSha256(url);
  const rendered = renderPkgbuild(template, { version, sha256: digest });
  check(rendered, { version });
  write(rendered, args);
}

function recipeKind(args, templatePath) {
  if (args.kind === "bin" || args.kind === "source") return args.kind;
  if (args.kind) throw new Error(`--kind must be source or bin, got ${args.kind}`);
  return templatePath.split(path.sep).includes("rustbox-bin") ? "bin" : "source";
}

function write(rendered, args) {
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, rendered);
    return;
  }
  process.stdout.write(rendered);
}

const invoked = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (invoked) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
  });
}
