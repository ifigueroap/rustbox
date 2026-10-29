import fs from "node:fs";
import path from "node:path";

const OUT = "/opt/cursor/artifacts/screenshots";

/** puppeteer-core is not a project dependency (it would add a large download
 * for a tool only used to take screenshots). Resolve it from PUPPETEER_CORE,
 * the local node_modules, or the path used in CI, in that order. */
async function loadPuppeteer() {
  const candidates = [
    process.env.PUPPETEER_CORE,
    "puppeteer-core",
    "/tmp/pptr/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return (await import(candidate)).default;
    } catch {
      // Try the next location.
    }
  }
  console.error(
    "mock/verify.mjs needs puppeteer-core. Install it with\n" +
      "  npm install --prefix /tmp/pptr puppeteer-core\n" +
      "or set PUPPETEER_CORE to its module path.",
  );
  process.exit(1);
}

const puppeteer = await loadPuppeteer();
const chrome = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  defaultViewport: { width: 1280, height: 820, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const logs = [];
page.on("console", (message) => logs.push(`${message.type()}: ${message.text()}`));
page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`));

const failures = [];
const results = [];

function check(name, condition, detail) {
  const entry = { name, ok: Boolean(condition), detail };
  results.push(entry);
  if (!entry.ok) failures.push(entry);
  console.log(`${entry.ok ? "ok  " : "FAIL"} ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

async function state() {
  return await page.evaluate(() => {
    const rail = document.querySelector("#workspace-rail");
    const switcher = document.querySelector("#workspace-switcher");
    const popup = document.querySelector("#workspace-switcher-popup");
    const banner = document.querySelector("#app-error");
    return {
      railRows: [...document.querySelectorAll("#workspace-list .ws")].map((node) => node.getAttribute("data-workspace-id")),
      popupRows: [...document.querySelectorAll("#workspace-switcher-popup .ws-popup-row:not(.ws-popup-add)")].map((node) => node.getAttribute("data-workspace-id")),
      railHidden: rail?.hidden,
      switcherHidden: switcher?.hidden,
      switcherLabel: document.querySelector("#workspace-switcher-name")?.textContent,
      popupHidden: popup?.hidden,
      sidebarServices: document.querySelectorAll("#service-list .svc").length,
      cards: document.querySelectorAll("#dash-grid .card").length,
      errorVisible: banner ? !banner.hidden : false,
      errorText: banner?.hidden ? "" : document.querySelector("#app-error-text")?.textContent,
      rawMissing: document.body.innerText.includes("Missing #workspace-list"),
      deskTitle: document.querySelector("#dash-title")?.textContent,
      deskLede: document.querySelector("#dash-lede")?.textContent,
      sidebarEmpty: !document.querySelector("#service-empty")?.hidden,
      deskEmpty: !document.querySelector("#dash-empty")?.hidden,
      dialogOpen: document.querySelector("#workspace-editor")?.open,
      includeOpen: document.querySelector("#include-services")?.open,
      activeId: window.__rustboxMock?.state.activeId ?? null,
      popupWidth: popup ? Math.round(popup.getBoundingClientRect().width) : 0,
      popupLeft: popup ? Math.round(popup.getBoundingClientRect().left) : 0,
      popupScrollsWide: popup ? popup.scrollWidth > popup.clientWidth + 2 : false,
      popupBg: popup ? getComputedStyle(popup).backgroundColor : "",
      popupNameColor: popup ? getComputedStyle(popup.querySelector(".ws-popup-name") ?? popup).color : "",
      popupAddColor: popup ? getComputedStyle(popup.querySelector(".ws-popup-add") ?? popup).color : "",
      manageTitle: document.querySelector("#manage-button")?.title,
      workspaceAddTitle: document.querySelector("#workspace-add")?.title,
      railChildren: rail?.childElementCount,
      railWidth: rail ? Math.round(rail.getBoundingClientRect().width) : 0,
      railToggleTitle: document.querySelector("#rail-toggle-button")?.title,
      railToggleHidden: document.querySelector("#rail-toggle-button")?.hidden,
      workspaceCount: window.__rustboxMock?.state.workspaces.length ?? -1,
    };
  });
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function shot(name, theme) {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
  }, theme);
  await settle();
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log("  shot:", file);
}

async function openCreator() {
  await page.click("#dash-workspace-add");
  await page.waitForSelector("#workspace-editor[open]");
}

async function fillName(name) {
  await page.evaluate((value) => {
    const input = document.querySelector("#workspace-name");
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, name);
}

async function clickPopupRow(index) {
  await page.click("#workspace-switcher-button");
  await settle();
  const rows = await page.$$("#workspace-switcher-popup .ws-popup-row:not(.ws-popup-add)");
  await rows[index].click();
  await settle();
}

await page.goto("http://localhost:1420/mock/index.html", { waitUntil: "networkidle0" });
await settle();

// --- 1. One workspace -------------------------------------------------------
let s = await state();
check("boot: rail hidden with one workspace", s.railHidden === true, s.railHidden);
check("boot: switcher hidden with one workspace", s.switcherHidden === true);
check("boot: rail toggle hidden with one workspace", s.railToggleHidden === true);
check("boot: services and cards painted", s.sidebarServices === 5 && s.cards === 5, {
  sidebar: s.sidebarServices,
  cards: s.cards,
});
check("boot: no error banner", s.errorVisible === false, s.errorText);
check("boot: no raw 'Missing #workspace-list'", s.rawMissing === false);
check("boot: rail keeps its two static children", s.railChildren === 2, s.railChildren);
await shot("rail-collapse-01-single-workspace-dark", "dark");

// --- 2. Create a second workspace with existing services --------------------
await openCreator();
const includable = await page.$$("#workspace-include-options input[data-include-service]");
check("create: include step lists the existing services", includable.length === 5, includable.length);
await fillName("Spotmind");
await includable[0].click();
await includable[1].click();
await shot("rail-collapse-02-new-workspace-dialog-dark", "dark");
await page.click("#workspace-save");
await settle();
s = await state();
check("create: dialog dismissed after Save", s.dialogOpen === false);
check("create: rail now visible", s.railHidden === false);
check("create: rail has both workspaces", s.railRows.length === 2, s.railRows.length);
check("create: no error from the re-render", s.errorVisible === false, s.errorText);
check("create: no raw 'Missing #workspace-list'", s.rawMissing === false);
check("create: new workspace is active and shows its two services", s.sidebarServices === 2 && s.deskTitle === "Spotmind", {
  sidebar: s.sidebarServices,
  title: s.deskTitle,
});
check("create: switcher stays out of the way while the rail shows", s.switcherHidden === true);
check("create: rail is slimmer than before (48px)", s.railWidth === 48, s.railWidth);
check("create: rail toggle offers 'Hide workspace rail'", s.railToggleTitle === "Hide workspace rail", s.railToggleTitle);
await shot("rail-collapse-03-rail-visible-dark", "dark");

// --- 3. Collapse the rail from the sidebar footer --------------------------
await page.click("#rail-toggle-button");
await settle();
s = await state();
check("collapse: rail hidden", s.railHidden === true);
check("collapse: switcher shown in the sidebar", s.switcherHidden === false);
check("collapse: switcher names the active workspace", s.switcherLabel === "Spotmind", s.switcherLabel);
check("collapse: services still painted", s.sidebarServices === 2, s.sidebarServices);
check("collapse: rail toggle offers 'Show workspace rail'", s.railToggleTitle === "Show workspace rail", s.railToggleTitle);
await shot("rail-collapse-04-switcher-dark", "dark");

// --- 4. The switcher popup -------------------------------------------------
await page.click("#workspace-switcher-button");
await settle();
s = await state();
check("popup: opens", s.popupHidden === false);
check("popup: lists every workspace", s.popupRows.length === 2, s.popupRows.length);
await shot("rail-collapse-05-switcher-popup-dark", "dark");
await page.click("#workspace-switcher-popup .ws-popup-add");
await settle();
s = await state();
check("popup: 'New workspace' opens the create dialog", s.dialogOpen === true);
await page.click("#workspace-cancel");
await settle();

// --- 5. Switch workspaces through the switcher ----------------------------
await clickPopupRow(0);
s = await state();
check("switch: first workspace selected", s.deskTitle === "Main", s.deskTitle);
check("switch: its five services painted", s.sidebarServices === 5, s.sidebarServices);

// --- 6. An empty workspace ------------------------------------------------
await openCreator();
await fillName("Personal");
await page.click("#workspace-save");
await settle();
s = await state();
check("empty: third workspace created", s.workspaceCount === 3, s.workspaceCount);
check("empty: sidebar explains the empty workspace", s.sidebarEmpty === true);
check("empty: desk explains the empty workspace", s.deskEmpty === true);
check("empty: desk names the workspace", (s.deskTitle ?? "") === "Personal", s.deskTitle);
await shot("rail-collapse-06-empty-workspace-dark", "dark");

// --- 7. Include services from the empty state ----------------------------
await page.click("#rail-toggle-button");
await settle();
await page.click("#dash-empty-include");
await settle();
const includeOptions = await page.$$("#include-options input[data-include-service]");
check("include: dialog offers services that are not in this workspace", includeOptions.length === 5, includeOptions.length);
await includeOptions[0].click();
await includeOptions[2].click();
await shot("rail-collapse-07-include-services-dark", "dark");
await page.click("#include-save");
await settle();
s = await state();
check("include: services appeared in the workspace", s.sidebarServices === 2, s.sidebarServices);
check("include: the desk no longer shows the empty state", s.deskEmpty === false);
check("include: no error", s.errorVisible === false, s.errorText);

// --- 8. Light theme -------------------------------------------------------
await shot("rail-collapse-08-rail-visible-light", "light");
await page.click("#rail-toggle-button");
await settle();
await shot("rail-collapse-09-switcher-light", "light");
await page.click("#workspace-switcher-button");
await settle();
await shot("rail-collapse-10-switcher-popup-light", "light");
await page.keyboard.press("Escape");
await settle();

// --- 9. Delete back to a single workspace --------------------------------
await page.evaluate(async () => {
  // Use the shell instance the page actually booted, not a fresh module copy:
  // a second `import()` would hold its own state and render over the live one.
  const { applyShellSnapshot } = window.__rustboxMock.shell;
  const mock = window.__rustboxMock;
  for (const extra of mock.state.workspaces.slice(1)) {
    const snap = await window.__TAURI_INTERNALS__.invoke("remove_workspace", { id: extra.id });
    applyShellSnapshot(snap);
  }
});
await settle();
s = await state();
check("delete: back to one workspace", s.workspaceCount === 1, s.workspaceCount);
check("delete: the stale popup list is empty", s.popupRows.length === 0, s.popupRows.length);
check("delete: rail hidden again", s.railHidden === true);
check("delete: switcher hidden again", s.switcherHidden === true);
check("delete: services still painted", s.sidebarServices === 5, s.sidebarServices);
check("delete: no raw 'Missing #workspace-list'", s.rawMissing === false);
check("delete: rail still keeps its static children", s.railChildren === 2, s.railChildren);
await shot("rail-collapse-11-back-to-one-light", "light");

// --- 10. Popup, dialogs, and footer at narrow and normal widths ------------
async function setViewport(width, height) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await settle();
}

await setViewport(1100, 760);
await openCreator();
await fillName("Spotmind");
await page.click("#workspace-save");
await settle();

// The rail is already hidden from the earlier collapse checks. Creating a
// workspace switches to that empty workspace, so return to Main (which still
// holds the services) and open one. The chip and the rename dialog then have
// a service webview to suspend and restore.
const mainId = await page.evaluate(() => window.__rustboxMock.state.workspaces[0].id);
await page.evaluate(async (id) => {
  const snap = await window.__TAURI_INTERNALS__.invoke("set_active_workspace", { id });
  window.__rustboxMock.shell.applyShellSnapshot(snap);
}, mainId);
const serviceId = await page.evaluate(() => window.__rustboxMock.state.services[0].id);
await page.evaluate(async (id) => {
  const snap = await window.__TAURI_INTERNALS__.invoke("set_active_service", { id });
  window.__rustboxMock.shell.applyShellSnapshot(snap);
}, serviceId);
await settle();
s = await state();
check("overlay: rail stays hidden so the chip is showing", s.railHidden === true && s.switcherHidden === false, {
  railHidden: s.railHidden,
  switcherHidden: s.switcherHidden,
});
check("overlay: a service is open before the chip menu", s.activeId === serviceId, s.activeId);

await page.click("#workspace-switcher-button");
await settle();
s = await state();
check("overlay: chip popup opens", s.popupHidden === false);
check("overlay: opening the chip hides the service webview", s.activeId === null, s.activeId);
check("overlay: popup background is opaque", s.popupBg !== "rgba(0, 0, 0, 0)" && s.popupBg !== "transparent", s.popupBg);
check("overlay: workspace names and New workspace use different colors", s.popupNameColor !== s.popupAddColor, {
  name: s.popupNameColor,
  add: s.popupAddColor,
});
check("overlay: popup does not scroll sideways", s.popupScrollsWide === false, s.popupWidth);
await shot("shell-overlay-01-switcher-popup-dark", "dark");
await shot("shell-overlay-02-switcher-popup-light", "light");

await setViewport(170, 720);
await settle();
s = await state();
check("narrow: popup stays inside a 170px window", s.popupLeft + s.popupWidth <= 170, {
  left: s.popupLeft,
  width: s.popupWidth,
});
check("narrow: popup is still open and opaque", s.popupHidden === false && s.popupBg !== "rgba(0, 0, 0, 0)");
check("narrow: popup does not scroll sideways", s.popupScrollsWide === false);
await shot("shell-overlay-03-switcher-narrow-dark", "dark");
await shot("shell-overlay-04-switcher-narrow-light", "light");

await page.keyboard.press("Escape");
await settle();
s = await state();
check("overlay: Escape closes the chip and restores the service", s.popupHidden === true && s.activeId === serviceId, {
  popupHidden: s.popupHidden,
  activeId: s.activeId,
});

await setViewport(1100, 760);
await page.evaluate((workspaceId) => {
  const workspace = window.__rustboxMock.state.workspaces.find((item) => item.id === workspaceId);
  window.__rustboxMock.shell.openWorkspaceEditor(workspace, "rename");
}, await page.evaluate(() => window.__rustboxMock.state.workspaces[0].id));
await settle();
s = await state();
check("overlay: rename dialog opens over a suspended service", s.dialogOpen === true && s.activeId === null, s);
await shot("shell-overlay-05-rename-dialog-dark", "dark");
await shot("shell-overlay-06-rename-dialog-light", "light");
await page.click("#workspace-cancel");
await settle();
s = await state();
check("overlay: closing rename restores the service", s.dialogOpen === false && s.activeId === serviceId, {
  dialogOpen: s.dialogOpen,
  activeId: s.activeId,
});

await page.click("#rail-toggle-button");
await settle();
await page.click("#collapse-button");
await settle();
s = await state();
check("footer: rail + is New workspace and sidebar + is Add a service", s.workspaceAddTitle === "New workspace" && s.manageTitle === "Add a service", {
  workspace: s.workspaceAddTitle,
  service: s.manageTitle,
});
await shot("shell-overlay-07-footer-collapsed-dark", "dark");
await shot("shell-overlay-08-footer-collapsed-light", "light");
await page.click("#collapse-button");
await settle();
await shot("shell-overlay-09-footer-expanded-dark", "dark");
await shot("shell-overlay-10-footer-expanded-light", "light");

// --- Updates: badge, settings, dialog ---------------------------------------
await page.click("#brand-button");
await settle();
await page.evaluate(() => {
  const mock = window.__rustboxMock;
  mock.state.update = {
    state: "available",
    current: "0.5.0",
    latest: "0.9.0",
    notes: "A signed release you install yourself.\nSessions stay on disk.",
    url: "https://github.com/ifigueroap/rustbox/releases/tag/v0.9.0",
    canInstall: true,
    autoCheck: true,
    lastCheckedAt: "2026-10-29T01:00:00Z",
  };
  mock.shell.applyShellSnapshot(mock.snapshot());
});
await settle();
s = await state();
const updateChrome = await page.evaluate(() => ({
  badgeHidden: document.querySelector("#update-badge")?.hidden,
  badgeLabel: document.querySelector("#update-badge")?.getAttribute("aria-label"),
  autoChecked: document.querySelector("#auto-update")?.checked,
  checkedText: document.querySelector("#update-checked")?.textContent,
  bannerHidden: document.querySelector("#app-error")?.hidden,
}));
check("updates: sidebar badge names the release", updateChrome.badgeHidden === false && updateChrome.badgeLabel === "Update available: v0.9.0", updateChrome);
check("updates: automatic checks default on", updateChrome.autoChecked === true, updateChrome.checkedText);
check("updates: settings name the last check without a banner", updateChrome.bannerHidden === true && updateChrome.checkedText.includes("Last checked"), updateChrome.checkedText);
await shot("update-01-badge-settings-dark", "dark");
await shot("update-02-badge-settings-light", "light");

const serviceIdForUpdate = await page.evaluate(() => window.__rustboxMock.state.services[0].id);
await page.evaluate((id) => {
  const row = document.querySelector(`#service-list .svc`);
  row?.click();
  return id;
}, serviceIdForUpdate);
await settle();
await page.click("#update-badge");
await settle();
const updateDialog = await page.evaluate(() => ({
  open: document.querySelector("#update-dialog")?.open,
  version: document.querySelector("#update-version")?.textContent,
  notes: document.querySelector("#update-notes")?.textContent,
  install: document.querySelector("#update-install")?.textContent,
  restartDisplay: getComputedStyle(document.querySelector("#update-restart")).display,
  activeId: window.__rustboxMock.state.activeId,
  errorHidden: document.querySelector("#app-error")?.hidden,
}));
check("updates: dialog opens above a suspended service", updateDialog.open === true && updateDialog.activeId === null, updateDialog);
check("updates: dialog shows the version and install action", updateDialog.version?.includes("0.9.0") && updateDialog.install === "Download and install" && updateDialog.restartDisplay === "none", updateDialog);
check("updates: dialog is not the error banner", updateDialog.errorHidden === true && updateDialog.notes?.includes("Sessions stay"));
await shot("update-03-dialog-dark", "dark");
await shot("update-04-dialog-light", "light");

console.log("\n--- console messages ---");
for (const line of logs) console.log(line);
console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
if (failures.length > 0) {
  console.log("FAILURES:", JSON.stringify(failures, null, 2));
  process.exitCode = 1;
}

await browser.close();
