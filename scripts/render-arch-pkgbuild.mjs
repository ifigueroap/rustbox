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
// The README's install one-liner downloads that asset:
//
//   d=$(mktemp -d) && cd "$d" && \
//     curl -fsSLO https://github.com/ifigueroap/rustbox/releases/latest/download/PKGBUILD && \
//     makepkg -si

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PKGBUILD_PATH = "packaging/arch/PKGBUILD";

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

/** Problems that keep the rendered PKGBUILD from being installable as-is. */
export function assertPkgbuild(content, { version } = {}) {
  const problems = [];
  const fields = {};
  for (const name of ["pkgname", "pkgver", "pkgrel", "arch", "license"]) {
    const match = content.match(new RegExp(`^${name}=(.*)$`, "m"));
    if (!match) problems.push(`missing ${name}`);
    else fields[name] = match[1].replace(/\s+#.*$/, "").replace(/^\(|\)$/g, "").trim();
  }
  if (fields.pkgname !== "rustbox") problems.push("pkgname");
  if (fields.arch !== "x86_64") problems.push("arch");
  if (fields.license !== "MIT") problems.push("license");
  if (version !== undefined && fields.pkgver !== cleanVersion(version)) {
    problems.push(`pkgver ${fields.pkgver} does not match ${cleanVersion(version)}`);
  }
  if (!/^\d+$/.test(fields.pkgrel ?? "")) problems.push("pkgrel");
  if (!/^sha256sums=\('[0-9a-f]{64}'\)$/m.test(content)) problems.push("sha256sums");
  if (!content.includes("/archive/refs/tags/v$pkgver.tar.gz")) {
    problems.push("tag tarball source");
  }
  if (!/^build\(\)/m.test(content)) problems.push("build()");
  if (!/^package\(\)/m.test(content)) problems.push("package()");
  for (const bin of ["webkit2gtk-4.1", "gtk3", "libayatana-appindicator"]) {
    if (!new RegExp(`^\\s+${bin.replace(/[.+]/g, "\\$&")}$`, "m").test(content)) {
      problems.push(`depends ${bin}`);
    }
  }
  if (/^(makedepends|depends)=\(.*\b(cargo|rustup)\b/m.test(content)) {
    problems.push("cargo is provided by rust, not named as a package");
  }
  if (problems.length > 0) {
    throw new Error(`PKGBUILD is not ready: ${problems.join(", ")}`);
  }
  return content;
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

  if (args["sha256-file"]) {
    // Offline path: the workflow downloads the tarball itself.
    const version = args.version;
    const digest = sha256(fs.readFileSync(args["sha256-file"]));
    const rendered = renderPkgbuild(template, { version, sha256: digest });
    assertPkgbuild(rendered, { version });
    write(rendered, args);
    return;
  }

  const version = args.version;
  if (!version) throw new Error("--version is required");
  const url = args.url ?? tagTarballUrl(repo, version);
  const digest = await fetchTarballSha256(url);
  const rendered = renderPkgbuild(template, { version, sha256: digest });
  assertPkgbuild(rendered, { version });
  write(rendered, args);
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
