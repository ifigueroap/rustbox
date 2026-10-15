import fs from "node:fs";

const tauri = JSON.parse(
  fs.readFileSync("src-tauri/tauri.conf.json", "utf8"),
).version;
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const cargoToml = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
const cargoLock = fs.readFileSync("src-tauri/Cargo.lock", "utf8");

const cargoVersion = cargoToml.match(/^version = "([^"]+)"/m)?.[1];
const lockMatch = cargoLock.match(
  /name = "rustbox"\r?\nversion = "([^"]+)"(?: # x-release-please-version)?/,
);
const cargoLockVersion = lockMatch?.[1];

const versions = {
  "src-tauri/tauri.conf.json": tauri,
  "package.json": pkg.version,
  "package-lock.json": lock.version,
  "package-lock.json packages": lock.packages?.[""]?.version,
  "src-tauri/Cargo.toml": cargoVersion,
  "src-tauri/Cargo.lock rustbox": cargoLockVersion,
};

const unique = new Set(Object.values(versions));
if (unique.size !== 1 || unique.has(undefined)) {
  console.error("App versions are out of sync:");
  for (const [file, version] of Object.entries(versions)) {
    console.error(`  ${file}: ${version ?? "(missing)"}`);
  }
  process.exit(1);
}

const tomlMarked = /^version = "[^"]+" # x-release-please-version/m.test(
  cargoToml,
);
const lockMarked =
  /name = "rustbox"\r?\nversion = "[^"]+" # x-release-please-version/.test(
    cargoLock,
  );

if (!tomlMarked || !lockMarked) {
  console.error(
    "Cargo.toml and the rustbox entry in Cargo.lock need an `x-release-please-version` comment on the version line.",
  );
  process.exit(1);
}

console.log(`App version ${[...unique][0]} is in sync.`);
