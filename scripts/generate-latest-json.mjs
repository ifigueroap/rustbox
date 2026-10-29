#!/usr/bin/env node
// Build the static updater manifest Tauri reads from GitHub Releases.
//
// The file is latest.json. Each platform entry is a URL of a release asset
// plus the contents of the matching .sig file. darwin-x86_64 and
// darwin-aarch64 share the universal macOS archive. The portable Windows
// executable and the Linux tar.gz are not listed: those installs are told
// about the release and cannot replace themselves.

import fs from "node:fs";
import path from "node:path";

export const PLATFORMS = [
  ["windows-x86_64", "rustbox-windows-x64-setup.exe", "windows"],
  ["linux-x86_64", "rustbox-linux-x64.AppImage", "linux"],
  ["darwin-x86_64", "rustbox-macos-universal.app.tar.gz", "macos"],
  ["darwin-aarch64", "rustbox-macos-universal.app.tar.gz", "macos"],
];

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function buildLatestJson({ version, notes, pubDate, signatures, repo, tag }) {
  const clean = String(version ?? "").trim().replace(/^v/, "");
  if (!SEMVER.test(clean)) {
    throw new Error(`version must be semver, got ${version}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(pubDate ?? "")) {
    throw new Error(`pubDate must be UTC RFC3339, got ${pubDate}`);
  }
  const repository = String(repo ?? "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`repo must be owner/name, got ${repo}`);
  }
  const releaseTag = String(tag ?? `v${clean}`);
  if (releaseTag !== `v${clean}`) {
    throw new Error(`tag ${releaseTag} does not match version ${clean}`);
  }
  const platforms = {};
  for (const [key, asset, signatureKey] of PLATFORMS) {
    const signature = String(signatures?.[signatureKey] ?? "").trim();
    if (!signature) {
      throw new Error(`missing ${signatureKey} signature for ${key}`);
    }
    platforms[key] = {
      signature,
      url: `https://github.com/${repository}/releases/download/${releaseTag}/${asset}`,
    };
  }
  return {
    version: clean,
    notes: String(notes ?? "").trim(),
    pub_date: pubDate,
    platforms,
  };
}

export function assertLatestJson(manifest) {
  const problems = [];
  if (!SEMVER.test(manifest?.version ?? "")) problems.push("version");
  if (!manifest?.pub_date) problems.push("pub_date");
  const tag = `v${manifest?.version ?? ""}`;
  for (const [key, asset] of PLATFORMS.map(([name, file]) => [name, file])) {
    const entry = manifest?.platforms?.[key];
    if (!entry?.signature) problems.push(`${key} signature`);
    const expected = `https://github.com/ifigueroap/rustbox/releases/download/${tag}/${asset}`;
    if (entry?.url !== expected && manifest?.version) {
      const suffix = `/releases/download/${tag}/${asset}`;
      if (!String(entry?.url ?? "").endsWith(suffix)) problems.push(`${key} url`);
    }
  }
  const intel = manifest?.platforms?.["darwin-x86_64"];
  const apple = manifest?.platforms?.["darwin-aarch64"];
  if (!intel || !apple || intel.url !== apple.url || intel.signature !== apple.signature) {
    problems.push("universal macos");
  }
  if (problems.length > 0) {
    throw new Error(`latest.json is incomplete: ${problems.join(", ")}`);
  }
  return manifest;
}

function readSignature(file) {
  return fs.readFileSync(file, "utf8");
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

export function selfTest() {
  const manifest = buildLatestJson({
    version: "v0.6.0",
    notes: "Notes",
    pubDate: "2026-10-29T01:00:00Z",
    signatures: { windows: "win-sig", linux: "linux-sig", macos: "mac-sig" },
    repo: "ifigueroap/rustbox",
    tag: "v0.6.0",
  });
  assertLatestJson(manifest);
  if (manifest.platforms["windows-x86_64"].url.endsWith("rustbox-windows-x64.exe")) {
    throw new Error("portable exe must not be an updater target");
  }
  if (manifest.platforms["linux-x86_64"].url.endsWith(".tar.gz")) {
    throw new Error("linux tar.gz must not be an updater target");
  }
  if (manifest.platforms["darwin-x86_64"].signature !== "mac-sig") {
    throw new Error("intel signature");
  }
  if (manifest.platforms["darwin-aarch64"].url !== manifest.platforms["darwin-x86_64"].url) {
    throw new Error("universal urls diverged");
  }
  let rejected = false;
  try {
    buildLatestJson({
      version: "0.6.0",
      notes: "",
      pubDate: "2026-10-29T01:00:00Z",
      signatures: { windows: "win-sig", linux: "", macos: "mac-sig" },
      repo: "ifigueroap/rustbox",
    });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("a missing signature was accepted");
  return manifest;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args["self-test"]) {
    selfTest();
    console.log("latest.json self-test ok");
    return;
  }
  if (args.check) {
    const manifest = JSON.parse(fs.readFileSync(args.check, "utf8"));
    assertLatestJson(manifest);
    console.log(`latest.json ok (${manifest.version})`);
    return;
  }
  const notes = args["notes-file"]
    ? fs.readFileSync(args["notes-file"], "utf8")
    : (args.notes ?? "");
  const manifest = buildLatestJson({
    version: args.version,
    notes,
    pubDate: args["pub-date"],
    signatures: {
      windows: readSignature(args["windows-sig"]),
      linux: readSignature(args["linux-sig"]),
      macos: readSignature(args["macos-sig"]),
    },
    repo: args.repo ?? "ifigueroap/rustbox",
    tag: args.tag,
  });
  assertLatestJson(manifest);
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, json);
  } else {
    process.stdout.write(json);
  }
}

const invoked = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (invoked) main();
