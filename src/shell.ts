import { LogicalPosition } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";

import {
  applyDomTranslations,
  getLocale,
  intlTag,
  resolveLocale,
  setLocale,
  t,
  type LanguagePreference,
  type Locale,
  type MessageKey,
} from "./i18n";
import { invoke } from "./ipc";
import { httpUrl, renderReleaseNotes } from "./release-notes";

interface Service {
  id: string;
  name: string;
  url: string;
  icon?: string | null;
  workspaceIcon?: string | null;
  color: string;
  userAgent?: string | null;
  useChromeUserAgent: boolean;
  preset?: string | null;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  workspaces: string[];
  allWorkspaces: boolean;
  workspaceSilenced: boolean;
  rawUnread: number;
  unread: number;
}

interface Workspace {
  id: string;
  name: string;
  icon?: string | null;
  color: string;
  dnd: boolean;
  order: number;
  unread: number;
  rawUnread: number;
  serviceCount: number;
}

interface Preset {
  id: string;
  name: string;
  url?: string | null;
  color: string;
  requiresServerUrl: boolean;
  urlHint: string;
}

interface Snapshot {
  services: Service[];
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeId: string | null;
  lastServiceId: string | null;
  chromeUserAgent: string;
  configPath: string;
  sessionsDir: string;
  sidebarCollapsed: boolean;
  workspaceRailHidden: boolean;
  doNotDisturb: boolean;
  closeToTray: boolean;
  trayAvailable: boolean;
  theme: ThemePreference;
  language?: LanguagePreference;
  osLocale?: Locale;
  appVersion: string;
  update: UpdateStatus;
}

type UpdatePhase = "idle" | "checking" | "available" | "upToDate" | "error";

interface UpdateStatus {
  state: UpdatePhase;
  current: string;
  latest: string | null;
  notes: string | null;
  url: string | null;
  canInstall: boolean;
  autoCheck: boolean;
  lastCheckedAt: string | null;
}

type ThemePreference = "auto" | "light" | "dark";

interface UnreadEvent {
  serviceId: string;
  count: number;
}

interface IconTarget {
  name: string;
  color: string;
  icon?: string | null;
  workspaceIcon?: string | null;
  preset?: string | null;
  url?: string | null;
}

const BRAND_ICONS: Record<string, string> = {
  whatsapp: "/brands/whatsapp.png",
  slack: "/brands/slack.png",
  discord: "/brands/discord.png",
  zulip: "/brands/zulip.svg",
  telegram: "/brands/telegram.svg",
  grok: "/brands/grok.png",
  chatgpt: "/brands/chatgpt.svg",
  claude: "/brands/claude.svg",
};

// ChatGPT's mark is white, so it sits on the brand plate. Claude's mark is the
// terracotta asterisk; a white glyph on the default grey plate looks washed out.
const GLYPH_BRANDS = new Set(["chatgpt"]);
const DEFAULT_SERVICE_COLOR = "#8d8478";
/** Mirrors `MAX_WORKSPACES` in src-tauri/src/config.rs. */
const MAX_WORKSPACES = 24;

let services: Service[] = [];
let workspaces: Workspace[] = [];
let activeWorkspaceId: string | null = null;
let presets: Preset[] = [];
let activeId: string | null = null;
let chromeUserAgent = "";
let configPath = "";
let sessionsDir = "";
let sidebarCollapsed = false;
let workspaceRailHidden = false;
let doNotDisturb = false;
let closeToTray = true;
let trayAvailable = false;
let themePreference: ThemePreference = "auto";
let languagePreference: LanguagePreference = "system";
let osLocale: Locale = "en";
/** Locale last sent to the tray. Null until the shell has reported one. */
let reportedLocale: Locale | null = null;
let appVersion = "";
let updateStatus: UpdateStatus = idleUpdate("");
/** Set once Download and install has finished for this version. */
let updateInstalledVersion: string | null = null;
let serviceMenu: Menu | null = null;
let serviceMenuItems: (CheckMenuItem | MenuItem | PredefinedMenuItem)[] = [];
let workspaceMenu: Menu | null = null;
let workspaceMenuItems: (MenuItem | PredefinedMenuItem)[] = [];
let pendingPreset: Preset | null = null;
let draggingId: string | null = null;
let draggingWorkspaceId: string | null = null;
let suspendedId: string | null = null;
let editingId: string | null = null;
let deskShowAll = false;
let workspaceSwitcherOpen = false;
/** Shell dialogs and the workspace chip popup. A child webview always paints
 * above the main webview, so each of these hides the active service first and
 * the last one to close puts it back. */
const shellCovers = new Set<string>();
let shellChain: Promise<void> = Promise.resolve();
let shellEpoch = 0;
let workspaceSavePending = false;
let includeServicesPending = false;
let includeTargetWorkspaceId: string | null = null;
const localIconUrls = new Map<string, string>();
const MAX_ICON_BYTES = 1_500_000;

interface ServiceFormValues {
  name: string;
  url: string;
  icon: string;
  color: string;
  userAgent: string;
  useChromeUserAgent: boolean;
  workspaces: string[];
  allWorkspaces: boolean;
}

interface ServiceFormSeed {
  name: string;
  url: string;
  icon: string;
  color: string;
  userAgent: string;
  useChromeUserAgent: boolean;
  preset?: string | null;
  brandColor: string;
  workspaces: string[];
  allWorkspaces: boolean;
}

interface ServiceForm {
  read(): Promise<ServiceFormValues>;
  set(values: ServiceFormSeed): void;
  reset(): void;
}

let customForm: ServiceForm | null = null;
let editorForm: ServiceForm | null = null;

function idleUpdate(current: string): UpdateStatus {
  return {
    state: "idle",
    current,
    latest: null,
    notes: null,
    url: null,
    canInstall: false,
    autoCheck: true,
    lastCheckedAt: null,
  };
}

function displayVersion(version: string | null | undefined): string {
  return (version ?? "").trim().replace(/^v/, "");
}

function lastCheckedText(status: UpdateStatus): string {
  if (status.state === "checking") return t("updates.checking");
  if (status.state === "error") return t("updates.failed");
  const when = formatChecked(status.lastCheckedAt);
  if (status.state === "upToDate") return `${when} · ${t("updates.upToDate")}`;
  return when;
}

function formatChecked(iso: string | null): string {
  if (!iso) return t("updates.lastNever");
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t("updates.lastNever");
  const when = new Intl.DateTimeFormat(intlTag(getLocale()), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
  return t("updates.lastChecked", { when });
}

function asLanguage(value: string | undefined): LanguagePreference {
  if (value === "en" || value === "es" || value === "system") return value;
  return "system";
}

function applyLanguage(report: boolean): void {
  const locale = resolveLocale(languagePreference, navigator.language, osLocale);
  setLocale(locale);
  document.documentElement.lang = locale;
  const select = document.querySelector<HTMLSelectElement>("#language-select");
  if (select) select.value = languagePreference;
  // The tray starts from the OS locale. Report the webview's resolution once,
  // and again whenever it changes, so the two stay together.
  if (report && reportedLocale !== locale && "__TAURI_INTERNALS__" in window) {
    reportedLocale = locale;
    void invoke("set_ui_locale", { locale }).catch(() => {
      reportedLocale = null;
    });
  }
}

function isServiceShortcut(event: KeyboardEvent): boolean {
  if (event.repeat || !(event.ctrlKey || event.metaKey)) return false;
  if (event.key === "Tab" && !event.altKey) return true;
  if (!event.shiftKey && /^[1-9]$/.test(event.key)) return true;
  return !event.altKey && event.shiftKey && event.key.toLowerCase() === "d";
}

function isWorkspaceShortcut(event: KeyboardEvent): boolean {
  if (event.repeat || !event.altKey || !(event.ctrlKey || event.metaKey)) return false;
  return !event.shiftKey && /^[1-9]$/.test(event.key);
}

function activeWorkspace(): Workspace | undefined {
  return workspaces.find((workspace) => workspace.id === activeWorkspaceId);
}

function workspaceName(): string {
  return activeWorkspace()?.name ?? "Main";
}

/** Services in the active workspace, in sidebar order. */
function visibleServices(): Service[] {
  const id = activeWorkspaceId;
  if (!id) return services;
  return services.filter(
    (service) => service.allWorkspaces || service.workspaces.includes(id),
  );
}

function workspaceTitle(workspace: Workspace): string {
  const parts = [t("count.workspaceSummary", { name: workspace.name, count: workspace.serviceCount })];
  if (workspace.dnd) parts.push(t("dnd.label"));
  if (workspace.unread > 0) parts.push(unreadLabel(workspace.unread));
  return parts.join(". ");
}

function workspaceRailVisible(): boolean {
  return !workspaceRailHidden && workspaces.length > 1;
}

/** The rail has no reason to exist with one workspace, and the sidebar chip
 * only earns its space once the rail is actually hidden. */
function workspaceSwitcherVisible(): boolean {
  return workspaces.length > 1 && !workspaceRailVisible();
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // The webview can reject the async clipboard. The selection path below still works.
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.append(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

function must<T extends Element>(selector: string): T {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`Missing ${selector}`);
  return node as T;
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return t("common.somethingWrong");
}

function initial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return Array.from(trimmed)[0]?.toUpperCase() ?? "?";
}

function textColor(hex: string): string {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((part) => part + part).join("") : raw;
  const red = Number.parseInt(full.slice(0, 2), 16);
  const green = Number.parseInt(full.slice(2, 4), 16);
  const blue = Number.parseInt(full.slice(4, 6), 16);
  if ([red, green, blue].some((part) => Number.isNaN(part))) return "#f7f3ec";
  const luma = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luma > 0.72 ? "#1a1612" : "#f7f3ec";
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function faviconCandidates(pageUrl: string): string[] {
  try {
    const url = new URL(pageUrl);
    return ["/favicon.ico", "/favicon.png", "/apple-touch-icon.png"].map((path) => `${url.origin}${path}`);
  } catch {
    return [];
  }
}

function iconColor(target: IconTarget): string {
  const color = (target.color || DEFAULT_SERVICE_COLOR).trim();
  if (color.toLowerCase() !== DEFAULT_SERVICE_COLOR) return color;
  const preset = presets.find((item) => item.id === target.preset);
  return preset?.color || color;
}

function paintLetter(node: HTMLElement, name: string, color: string): void {
  node.classList.remove("glyph", "tile");
  node.style.background = color;
  node.style.color = textColor(color);
  node.textContent = initial(name);
}

function mountImage(node: HTMLElement, sources: string[], onFail: () => void): void {
  const image = document.createElement("img");
  image.alt = "";
  image.draggable = false;
  let index = 0;
  let armed = false;
  const show = (): void => {
    const source = sources[index];
    if (!source) {
      onFail();
      return;
    }
    index += 1;
    image.src = source;
  };
  image.addEventListener("error", () => {
    if (armed) show();
  });
  node.append(image);
  armed = true;
  show();
}

function paintAvatar(node: HTMLElement, target: IconTarget): void {
  const color = iconColor(target);
  node.replaceChildren();
  node.classList.remove("glyph", "tile");
  node.style.background = color;
  node.style.color = textColor(color);
  const explicit = target.icon?.trim() ?? "";
  if (explicit.startsWith("local:")) {
    const data = localIconUrls.get(explicit);
    if (data) {
      node.classList.add("tile");
      node.style.background = "transparent";
      mountImage(node, [data], () => paintLetter(node, target.name, color));
      return;
    }
    paintLetter(node, target.name, color);
    return;
  }
  if (explicit && isUrl(explicit)) {
    node.classList.add("tile");
    node.style.background = "transparent";
    mountImage(node, [explicit], () => paintLetter(node, target.name, color));
    return;
  }
  if (explicit) {
    node.textContent = explicit;
    return;
  }
  const preset = target.preset ?? "";
  const brand = BRAND_ICONS[preset];
  const workspaceIcon = target.workspaceIcon?.trim() ?? "";
  if (workspaceIcon && (preset === "slack" || preset === "zulip")) {
    node.classList.add("tile");
    node.style.background = "transparent";
    mountImage(
      node,
      [workspaceIcon, ...(brand ? [brand] : [])],
      () => paintLetter(node, target.name, color),
    );
    return;
  }
  if (brand) {
    const glyph = GLYPH_BRANDS.has(preset);
    node.classList.add(glyph ? "glyph" : "tile");
    if (!glyph) node.style.background = "transparent";
    mountImage(node, [brand], () => paintLetter(node, target.name, color));
    return;
  }
  const favicons = target.url ? faviconCandidates(target.url) : [];
  if (favicons.length > 0) {
    node.classList.add("tile");
    node.style.background = "transparent";
    mountImage(node, favicons, () => paintLetter(node, target.name, color));
    return;
  }
  paintLetter(node, target.name, color);
}

/** The shell is mounted once per document. Tests replace the body markup, so
 * the guard lives on `#shell` rather than on module state. */
export function mountShell(): void {
  const shell = document.querySelector<HTMLElement>("#shell");
  if (!shell || shell.dataset.wired === "true") return;
  languagePreference = "system";
  osLocale = "en";
  reportedLocale = null;
  setLocale(resolveLocale("system", navigator.language, "en"));
  document.documentElement.lang = getLocale();
  shell.dataset.wired = "true";
  // Tests swap the document. Drop covers from the previous document so a
  // restore cannot paint into the new one.
  shellEpoch += 1;
  shellCovers.clear();
  suspendedId = null;
  workspaceSwitcherOpen = false;
  shellChain = Promise.resolve();
  abandonConfirmDialog();
  wireEvents();
}

function onShellChain(task: () => Promise<void> | void): Promise<void> {
  const epoch = shellEpoch;
  const next = shellChain.then(
    async () => {
      if (epoch !== shellEpoch) return;
      await task();
    },
    async () => {
      if (epoch !== shellEpoch) return;
      await task();
    },
  );
  shellChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** Remember that `key` needs the service webview out of the way. Claiming is
 * synchronous so a release queued in the same turn cannot restore early. */
function claimCover(key: string): void {
  shellCovers.add(key);
}

async function suspendForCover(): Promise<void> {
  await onShellChain(async () => {
    if (shellCovers.size === 0) return;
    if (suspendedId || !activeId) return;
    const previous = activeId;
    suspendedId = previous;
    const snapshot = await run(() => invoke<Snapshot>("set_active_service", { id: null }));
    if (shellCovers.size === 0) {
      suspendedId = null;
      if (!snapshot) return;
      const back = await run(() => invoke<Snapshot>("set_active_service", { id: previous }));
      if (back) applySnapshot(back);
      return;
    }
    if (!snapshot) {
      if (activeId === previous) suspendedId = null;
      return;
    }
    applySnapshot(snapshot);
  });
}

function releaseCover(key: string): Promise<void> {
  return onShellChain(async () => {
    if (!shellCovers.delete(key)) return;
    if (shellCovers.size > 0) return;
    const restore = suspendedId;
    suspendedId = null;
    if (!restore || activeId) return;
    const service = services.find((item) => item.id === restore);
    if (!service || !serviceInWorkspace(service, activeWorkspaceId)) return;
    const snapshot = await run(() => invoke<Snapshot>("set_active_service", { id: restore }));
    if (snapshot) applySnapshot(snapshot);
  });
}

interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmNodes {
  dialog: HTMLDialogElement;
  form: HTMLFormElement;
  title: HTMLElement;
  message: HTMLElement;
  accept: HTMLButtonElement;
  cancel: HTMLButtonElement;
}

let confirmChain: Promise<unknown> = Promise.resolve();
let confirmPending: ((accepted: boolean) => void) | null = null;
let confirmGeneration = 0;

function confirmNodes(): ConfirmNodes | null {
  const dialog = document.querySelector<HTMLDialogElement>("#confirm-dialog");
  const form = document.querySelector<HTMLFormElement>("#confirm-form");
  const title = document.querySelector<HTMLElement>("#confirm-title");
  const message = document.querySelector<HTMLElement>("#confirm-message");
  const accept = document.querySelector<HTMLButtonElement>("#confirm-accept");
  const cancel = document.querySelector<HTMLButtonElement>("#confirm-cancel");
  if (!dialog || !form || !title || !message || !accept || !cancel) return null;
  return { dialog, form, title, message, accept, cancel };
}

/** Drop a prompt left open by a previous document. Resolves it as cancel. */
function abandonConfirmDialog(): void {
  confirmGeneration += 1;
  const pending = confirmPending;
  confirmPending = null;
  confirmChain = Promise.resolve();
  const dialog = document.querySelector<HTMLDialogElement>("#confirm-dialog");
  if (dialog?.open) dialog.close();
  pending?.(false);
}

function settleConfirm(accepted: boolean): void {
  const resolve = confirmPending;
  if (!resolve) return;
  confirmPending = null;
  const dialog = document.querySelector<HTMLDialogElement>("#confirm-dialog");
  if (dialog?.open) dialog.close();
  resolve(accepted);
}

function openConfirmDialog(options: ConfirmDialogOptions, generation: number): Promise<boolean> {
  const nodes = confirmNodes();
  if (!nodes || generation !== confirmGeneration) return Promise.resolve(false);
  nodes.title.textContent = options.title;
  nodes.message.textContent = options.message;
  nodes.accept.textContent = options.confirmLabel ?? t("common.confirm");
  nodes.cancel.textContent = options.cancelLabel ?? t("common.cancel");
  nodes.accept.classList.toggle("danger", options.danger === true);
  const focusCancel = options.danger === true;
  nodes.cancel.toggleAttribute("autofocus", focusCancel);
  nodes.accept.toggleAttribute("autofocus", !focusCancel);
  return new Promise((resolve) => {
    if (generation !== confirmGeneration) {
      resolve(false);
      return;
    }
    confirmPending = resolve;
    if (!nodes.dialog.open) nodes.dialog.showModal();
    (focusCancel ? nodes.cancel : nodes.accept).focus();
  });
}

/**
 * In-app replacement for `window.confirm`. A child service webview paints
 * above this HTML, so the prompt suspends the active service and the caller's
 * cover (claimed before this await) keeps it hidden until the follow-up
 * action finishes. Escape, Close, Cancel, and a backdrop click resolve false.
 * Enter activates the focused button: Cancel on a danger prompt, otherwise
 * the confirm button.
 */
function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  const generation = confirmGeneration;
  const epoch = shellEpoch;
  const result = confirmChain.then(() => {
    if (generation !== confirmGeneration || epoch !== shellEpoch) return false;
    return presentConfirm(options, generation);
  });
  confirmChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function presentConfirm(options: ConfirmDialogOptions, generation: number): Promise<boolean> {
  if (generation !== confirmGeneration || !confirmNodes()) return false;
  claimCover("confirm");
  try {
    await suspendForCover();
    if (generation !== confirmGeneration) return false;
    return await openConfirmDialog(options, generation);
  } finally {
    await releaseCover("confirm");
  }
}

function wireConfirmDialog(): void {
  const nodes = confirmNodes();
  if (!nodes) return;
  nodes.form.addEventListener("submit", (event) => {
    // Buttons are type="button". A submit must not confirm a danger prompt
    // whose Cancel button is the one with focus.
    event.preventDefault();
  });
  nodes.accept.addEventListener("click", () => settleConfirm(true));
  nodes.cancel.addEventListener("click", () => settleConfirm(false));
  document.querySelector<HTMLButtonElement>("#confirm-close")?.addEventListener("click", () => {
    settleConfirm(false);
  });
  nodes.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    settleConfirm(false);
  });
  nodes.dialog.addEventListener("click", (event) => {
    if (event.target === nodes.dialog) settleConfirm(false);
  });
  nodes.dialog.addEventListener(
    "keydown",
    (event) => {
      if (!confirmPending) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        settleConfirm(false);
        return;
      }
      // Enter activates the focused button. jsdom does not synthesize that
      // click, and a danger prompt focuses Cancel, so this must not confirm.
      if (
        event.key !== "Enter" ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing
      ) {
        return;
      }
      const focused = document.activeElement;
      if (!(focused instanceof HTMLButtonElement) || !nodes.dialog.contains(focused)) return;
      event.preventDefault();
      event.stopPropagation();
      focused.click();
    },
    true,
  );
}

/** Native menu actions run while the menu is still tearing down. Opening a
 * dialog in that same turn is dropped on WebView2, so wait one task. */
function deferMenuAction(action: () => void): void {
  window.setTimeout(action, 0);
}

/** Apply a backend snapshot exactly as an `app-snapshot` event would. */
export function applyShellSnapshot(snapshot: Snapshot): void {
  applySnapshot(snapshot);
}

export function currentWorkspaceState(): {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  railVisible: boolean;
  switcherVisible: boolean;
  railChildren: number;
} {
  const rail = document.querySelector<HTMLElement>("#workspace-rail");
  return {
    workspaces,
    activeWorkspaceId,
    railVisible: workspaceRailVisible(),
    switcherVisible: workspaceSwitcherVisible(),
    railChildren: rail?.childElementCount ?? 0,
  };
}

export {
  render,
  saveWorkspaceEditor,
  closeWorkspaceEditor,
  openWorkspaceEditor,
  openIncludeServices,
  saveIncludeServices,
  openUpdateDialog,
  closeUpdateDialog,
  confirmDialog,
};

function applySnapshot(snapshot: Snapshot): void {
  services = snapshot.services;
  workspaces = [...snapshot.workspaces].sort((left, right) => left.order - right.order);
  activeWorkspaceId = snapshot.activeWorkspaceId;
  activeId = snapshot.activeId;
  chromeUserAgent = snapshot.chromeUserAgent;
  configPath = snapshot.configPath;
  sessionsDir = snapshot.sessionsDir;
  sidebarCollapsed = snapshot.sidebarCollapsed;
  workspaceRailHidden = snapshot.workspaceRailHidden;
  doNotDisturb = snapshot.doNotDisturb;
  closeToTray = snapshot.closeToTray;
  trayAvailable = snapshot.trayAvailable;
  themePreference = snapshot.theme;
  languagePreference = asLanguage(snapshot.language);
  osLocale = snapshot.osLocale === "es" ? "es" : "en";
  applyLanguage(true);
  appVersion = snapshot.appVersion;
  updateStatus = snapshot.update ?? idleUpdate(snapshot.appVersion);
  if (updateInstalledVersion && updateInstalledVersion !== updateStatus.latest) {
    updateInstalledVersion = null;
  }
  const closeTray = document.querySelector<HTMLInputElement>("#close-tray");
  if (closeTray) {
    closeTray.checked = closeToTray;
    closeTray.disabled = !trayAvailable;
    const closeTitle = trayAvailable ? t("settings.closeToTrayOn") : t("settings.closeToTrayOff");
    closeTray.title = closeTitle;
    const closeLabel = closeTray.closest("label");
    if (closeLabel) closeLabel.title = closeTitle;
  }
  const railToggle = document.querySelector<HTMLInputElement>("#rail-toggle");
  if (railToggle) {
    railToggle.checked = !workspaceRailHidden;
    railToggle.disabled = workspaces.length < 2;
    const railTitle =
      workspaces.length < 2 ? t("settings.workspaceRailNeedsSecond") : t("settings.workspaceRailHint");
    railToggle.title = railTitle;
    const railLabel = railToggle.closest("label");
    if (railLabel) railLabel.title = railTitle;
  }
  if (editingId && !services.some((service) => service.id === editingId)) closeEditor();
  const active = services.find((service) => service.id === activeId);
  document.title = active ? `${active.name} - Rustbox` : "Rustbox";
  const shell = must<HTMLElement>("#shell");
  shell.classList.toggle("sidebar-collapsed", sidebarCollapsed);
  shell.classList.toggle("rail-hidden", !workspaceRailVisible());
  applyTheme();
  render();
  void hydrateLocalIcons().then((changed) => {
    if (changed) render();
  });
}

async function hydrateLocalIcons(): Promise<boolean> {
  const tokens = new Set<string>();
  for (const service of services) {
    const icon = service.icon?.trim() ?? "";
    if (icon.startsWith("local:")) tokens.add(icon);
  }
  for (const workspace of workspaces) {
    const icon = workspace.icon?.trim() ?? "";
    if (icon.startsWith("local:")) tokens.add(icon);
  }
  let changed = false;
  await Promise.all(
    [...tokens].map(async (token) => {
      if (localIconUrls.has(token)) return;
      try {
        localIconUrls.set(token, await invoke<string>("read_local_icon", { token }));
      } catch {
        localIconUrls.set(token, "");
      }
      changed = true;
    }),
  );
  return changed;
}

function applyTheme(): void {
  document.documentElement.dataset.theme = themePreference;
  const select = document.querySelector<HTMLSelectElement>("#theme-select");
  if (select) select.value = themePreference;
}

async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    showError(errorText(error));
    return undefined;
  }
}

const ERROR_FIELDS = [
  "#manager-error",
  "#editor-error",
  "#custom-error",
  "#workspace-error",
  "#include-error",
];

function showError(message: string): void {
  for (const selector of ERROR_FIELDS) {
    const node = document.querySelector<HTMLElement>(selector);
    if (!node) continue;
    node.hidden = false;
    node.textContent = message;
  }
  // Errors belong in the banner. #stage-status keeps its other job, the
  // "Opening <service>" line, and is never a dumping ground for raw text at
  // the bottom of the window.
  const banner = document.querySelector<HTMLElement>("#app-error");
  if (banner) {
    banner.hidden = false;
    const text = document.querySelector<HTMLElement>("#app-error-text");
    if (text) {
      text.textContent = message;
    } else {
      banner.textContent = message;
    }
  }
  const stage = document.querySelector<HTMLElement>("#stage-status");
  if (!stage) return;
  stage.hidden = true;
  delete stage.dataset.error;
  stage.textContent = "";
}

function clearError(): void {
  for (const selector of ERROR_FIELDS) {
    const node = document.querySelector<HTMLElement>(selector);
    if (!node) continue;
    node.hidden = true;
    node.textContent = "";
  }
  const banner = document.querySelector<HTMLElement>("#app-error");
  if (banner) {
    banner.hidden = true;
    const text = document.querySelector<HTMLElement>("#app-error-text");
    if (text) text.textContent = "";
  }
  const stage = document.querySelector<HTMLElement>("#stage-status");
  if (!stage) return;
  delete stage.dataset.error;
}
async function activate(id: string): Promise<void> {
  clearError();
  closeEditor();
  // Explicit navigation cancels a cover that was about to restore another service.
  suspendedId = null;
  await onShellChain(async () => {
    const snapshot = await run(() => invoke<Snapshot>("set_active_service", { id }));
    if (snapshot) applySnapshot(snapshot);
  });
}

async function showDashboard(): Promise<void> {
  clearError();
  suspendedId = null;
  if (!activeId) {
    render();
    return;
  }
  await onShellChain(async () => {
    if (!activeId) return;
    const snapshot = await run(() => invoke<Snapshot>("set_active_service", { id: null }));
    if (snapshot) applySnapshot(snapshot);
  });
}

async function setCollapsed(collapsed: boolean): Promise<void> {
  const shell = must<HTMLElement>("#shell");
  shell.classList.toggle("sidebar-collapsed", collapsed);
  const snapshot = await run(() => invoke<Snapshot>("set_sidebar_collapsed", { collapsed }));
  if (snapshot) applySnapshot(snapshot);
  else shell.classList.toggle("sidebar-collapsed", sidebarCollapsed);
}

/** Run one render stage. A failure in one stage must not blank the others, and
 * it must never leave a half-painted shell, so the error goes to the banner. */
function renderStageSafely(name: string, stage: () => void): string | null {
  try {
    stage();
    return null;
  } catch (error) {
    const message = `${name}: ${errorText(error)}`;
    console.error(`rustbox: ${message}`);
    return message;
  }
}

/** The last message `render` itself raised, so a later successful render only
 * clears errors it owns and never wipes an unrelated dialog error. */
let renderFailure: string | null = null;

function render(): void {
  applyDomTranslations();
  const failures = [
    renderStageSafely(t("render.workspaceRail"), renderWorkspaceRail),
    renderStageSafely(t("render.workspaceSwitcher"), renderWorkspaceSwitcher),
    renderStageSafely(t("render.sidebar"), renderSidebar),
    renderStageSafely(t("render.desk"), renderStage),
    renderStageSafely(t("render.serviceDialog"), () => {
      if (must<HTMLDialogElement>("#manager").open) renderManager();
    }),
  ].filter((message): message is string => message !== null);
  if (failures.length > 0) {
    renderFailure = failures.join(" — ");
    showError(renderFailure);
  } else if (renderFailure !== null) {
    renderFailure = null;
    clearError();
  }
  refreshOpenCopy();
}

function workspaceEditorTitle(workspace: Workspace | null): string {
  if (!workspace || !workspaceDraft || workspaceDraft.mode === "create") return t("workspace.new");
  if (workspaceDraft.mode === "appearance") return t("workspace.editTitle", { name: workspace.name });
  return t("workspace.renameTitle", { name: workspace.name });
}

function includeHint(): string {
  const pinned = services.filter((service) => service.allWorkspaces).length;
  if (pinned > 0) return t("count.alreadyEverywhere", { count: pinned });
  return t("include.hint");
}

/** Dialogs stay open across a language change, so their dynamic copy is painted again. */
function refreshOpenCopy(): void {
  syncEditorSave();
  const workspaceDialog = document.querySelector<HTMLDialogElement>("#workspace-editor");
  if (workspaceDialog?.open && workspaceDraft) {
    const nodes = workspaceEditorNodes();
    const workspace = workspaces.find((item) => item.id === workspaceDraft?.id) ?? null;
    nodes.title.textContent = workspaceEditorTitle(workspace);
    syncWorkspaceSave();
  }
  const includeDialog = document.querySelector<HTMLDialogElement>("#include-services");
  if (includeDialog?.open && includeTargetWorkspaceId) {
    const workspace = workspaces.find((item) => item.id === includeTargetWorkspaceId);
    if (workspace) {
      const nodes = includeNodes();
      nodes.title.textContent = t("include.titleNamed", { name: workspace.name });
      nodes.hint.textContent = includeHint();
    }
    syncIncludeSave();
  }
  if (document.querySelector<HTMLDialogElement>("#update-dialog")?.open) paintUpdateDialog();
}

/** The static children of the rail (`#workspace-list`, `#workspace-add`) live
 * in index.html. They are never removed: the rail is only hidden, and only the
 * rows inside `#workspace-list` are rebuilt. Replacing the rail's children
 * used to delete them for good, so the next render threw "Missing
 * #workspace-list" and took the sidebar and desk down with it. */
function renderWorkspaceRail(): void {
  const rail = must<HTMLElement>("#workspace-rail");
  const shell = must<HTMLElement>("#shell");
  const visible = workspaceRailVisible();
  rail.hidden = !visible;
  rail.dataset.count = String(workspaces.length);
  shell.classList.toggle("rail-visible", visible);
  shell.classList.toggle("rail-hidden", !visible);

  const add = rail.querySelector<HTMLButtonElement>("#workspace-add");
  if (add) {
    add.hidden = workspaces.length >= MAX_WORKSPACES;
    const label = t("settings.newWorkspace");
    add.title = label;
    add.setAttribute("aria-label", label);
  }

  const list = rail.querySelector<HTMLElement>("#workspace-list");
  if (!list) throw new Error("Missing #workspace-list");
  list.replaceChildren();
  if (!visible) return;
  for (const [index, workspace] of workspaces.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = workspace.id === activeWorkspaceId ? "ws active" : "ws";
    button.style.setProperty("--ws-color", workspace.color || DEFAULT_SERVICE_COLOR);
    button.title = workspaceTitle(workspace);
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-selected", workspace.id === activeWorkspaceId ? "true" : "false");
    button.setAttribute("role", "option");
    button.dataset.workspaceId = workspace.id;
    button.draggable = true;
    const hint = index < 9 ? ` (Ctrl+Alt+${index + 1})` : "";
    button.title = `${workspaceTitle(workspace)}${hint}`;

    const mark = document.createElement("span");
    mark.className = "ws-mark";
    paintWorkspaceMark(mark, workspace);
    mark.classList.toggle("dnd", workspace.dnd);
    button.append(mark);

    if (workspace.unread > 0) {
      const badge = document.createElement("span");
      badge.className = "ws-badge";
      badge.textContent = workspace.unread > 99 ? "99+" : String(workspace.unread);
      button.append(badge);
    }
    if (workspace.dnd) {
      const flag = document.createElement("span");
      flag.className = "ws-dnd";
      flag.title = t("dnd.label");
      flag.setAttribute("aria-hidden", "true");
      flag.innerHTML =
        '<svg viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M21 12.8A8.5 8.5 0 0 1 11.2 3a8.5 8.5 0 1 0 9.8 9.8z"/></svg>';
      button.append(flag);
    }

    button.addEventListener("click", () => {
      void switchWorkspace(workspace.id);
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      void openWorkspaceMenu(workspace.id, event.clientX, event.clientY);
    });
    button.addEventListener("dragstart", () => {
      draggingWorkspaceId = workspace.id;
    });
    button.addEventListener("dragend", () => {
      draggingWorkspaceId = null;
      list.querySelectorAll(".drop-target").forEach((node) => node.classList.remove("drop-target"));
    });
    button.addEventListener("dragover", (event) => {
      event.preventDefault();
      button.classList.add("drop-target");
    });
    button.addEventListener("dragleave", () => button.classList.remove("drop-target"));
    button.addEventListener("drop", (event) => {
      event.preventDefault();
      button.classList.remove("drop-target");
      const moving = draggingWorkspaceId;
      if (!moving || moving === workspace.id) return;
      const ids = workspaces.map((item) => item.id).filter((id) => id !== moving);
      const index = ids.indexOf(workspace.id);
      ids.splice(index, 0, moving);
      void run(async () => {
        applySnapshot(await invoke<Snapshot>("reorder_workspaces", { ids }));
      });
    });
    list.append(button);
  }
}

/** The compact workspace switcher at the top of the sidebar. It appears only
 * while the full rail is hidden, so switching workspaces stays discoverable
 * after collapsing the rail. */
function renderWorkspaceSwitcher(): void {
  const container = must<HTMLElement>("#workspace-switcher");
  const button = must<HTMLButtonElement>("#workspace-switcher-button");
  const mark = must<HTMLElement>("#workspace-switcher-mark");
  const name = must<HTMLElement>("#workspace-switcher-name");
  const popup = must<HTMLElement>("#workspace-switcher-popup");
  const visible = workspaceSwitcherVisible();
  container.hidden = !visible;
  if (!visible) {
    if (workspaceSwitcherOpen || shellCovers.has("switcher")) closeWorkspaceSwitcher();
    // Leaving the old rows behind kept a stale workspace list in the DOM after
    // the last extra workspace was deleted.
    popup.hidden = true;
    popup.replaceChildren();
    clearWorkspacePopupPlacement(popup);
    mark.replaceChildren();
    return;
  }

  const active = activeWorkspace();
  const label = active?.name ?? t("nav.workspaces");
  mark.replaceChildren();
  if (active) paintWorkspaceMark(mark, active);
  mark.classList.toggle("dnd", Boolean(active?.dnd));
  name.textContent = label;
  button.title = t("nav.switchWorkspace", { name: label });
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-expanded", workspaceSwitcherOpen ? "true" : "false");
  button.dataset.workspaceId = active?.id ?? "";

  popup.hidden = !workspaceSwitcherOpen;
  popup.replaceChildren();
  if (!workspaceSwitcherOpen) return;
  for (const [index, workspace] of workspaces.entries()) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = workspace.id === activeWorkspaceId ? "ws-popup-row active" : "ws-popup-row";
    row.style.setProperty("--ws-color", workspace.color || DEFAULT_SERVICE_COLOR);
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", workspace.id === activeWorkspaceId ? "true" : "false");
    row.dataset.workspaceId = workspace.id;
    const hint = index < 9 ? ` (Ctrl+Alt+${index + 1})` : "";
    row.title = `${workspaceTitle(workspace)}${hint}`;

    const rowMark = document.createElement("span");
    rowMark.className = "ws-mark";
    paintWorkspaceMark(rowMark, workspace);
    rowMark.classList.toggle("dnd", workspace.dnd);
    const rowName = document.createElement("span");
    rowName.className = "ws-popup-name";
    rowName.textContent = workspace.name;
    row.append(rowMark, rowName);

    if (workspace.unread > 0) {
      const badge = document.createElement("span");
      badge.className = "ws-badge";
      badge.textContent = workspace.unread > 99 ? "99+" : String(workspace.unread);
      row.append(badge);
    }
    if (workspace.dnd) {
      const flag = document.createElement("span");
      flag.className = "ws-dnd";
      flag.title = t("dnd.label");
      flag.setAttribute("aria-hidden", "true");
      flag.innerHTML =
        '<svg viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M21 12.8A8.5 8.5 0 0 1 11.2 3a8.5 8.5 0 1 0 9.8 9.8z"/></svg>';
      row.append(flag);
    }

    row.addEventListener("click", () => {
      const restore = suspendedId;
      const same = workspace.id === activeWorkspaceId;
      // Switching workspace must not put the previous service back on top of
      // the desk. Closing on the current workspace still restores it.
      if (!same) suspendedId = null;
      closeWorkspaceSwitcher();
      if (same) return;
      void (async () => {
        await switchWorkspace(workspace.id);
        if (!restore || activeId) return;
        const service = services.find((item) => item.id === restore);
        if (service && serviceInWorkspace(service, activeWorkspaceId)) await activate(restore);
      })();
    });
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      closeWorkspaceSwitcher();
      void openWorkspaceMenu(workspace.id, event.clientX, event.clientY);
    });
    popup.append(row);
  }

  const add = document.createElement("button");
  add.type = "button";
  add.className = "ws-popup-row ws-popup-add";
  add.textContent = t("settings.newWorkspace");
  add.disabled = workspaces.length >= MAX_WORKSPACES;
  add.addEventListener("click", () => {
    // Claim the editor before the popup releases, or the service webview
    // pops back for a frame and covers the dialog.
    openWorkspaceEditor(null, "create");
    closeWorkspaceSwitcher();
  });
  popup.append(add);
  placeWorkspacePopup();
}

function clearWorkspacePopupPlacement(popup: HTMLElement): void {
  popup.style.top = "";
  popup.style.left = "";
  popup.style.width = "";
  popup.style.maxHeight = "";
}

/** The chip list is HTML, so it cannot paint over a child webview. Pin it to
 * the viewport (never wider than the window) and keep it in the shell's
 * stacking order, above the sidebar and, once the service is suspended, above
 * the empty stage. */
function placeWorkspacePopup(): void {
  const popup = document.querySelector<HTMLElement>("#workspace-switcher-popup");
  const button = document.querySelector<HTMLElement>("#workspace-switcher-button");
  if (!popup || !button) return;
  if (popup.hidden) {
    clearWorkspacePopupPlacement(popup);
    return;
  }
  const rect = button.getBoundingClientRect();
  const margin = 8;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const available = Math.max(96, viewportWidth - margin * 2);
  const width = Math.min(Math.max(rect.width, Math.min(240, available)), available);
  let left = rect.left;
  if (left + width > viewportWidth - margin) left = Math.max(margin, viewportWidth - margin - width);
  if (left < margin) left = margin;
  const top = Math.min(Math.max(margin, rect.bottom + 4), Math.max(margin, viewportHeight - margin));
  const maxHeight = Math.max(96, viewportHeight - top - margin);
  popup.style.top = `${Math.round(top)}px`;
  popup.style.left = `${Math.round(left)}px`;
  popup.style.width = `${Math.round(width)}px`;
  popup.style.maxHeight = `${Math.round(maxHeight)}px`;
}

function revealWorkspaceSwitcher(): void {
  if (!shellCovers.has("switcher")) return;
  if (!workspaceSwitcherVisible()) {
    void releaseCover("switcher");
    return;
  }
  workspaceSwitcherOpen = true;
  renderWorkspaceSwitcher();
  document.querySelector<HTMLButtonElement>("#workspace-switcher-popup .ws-popup-row")?.focus();
}

function openWorkspaceSwitcher(): void {
  if (workspaceSwitcherOpen || shellCovers.has("switcher")) return;
  claimCover("switcher");
  if (suspendedId || !activeId) {
    revealWorkspaceSwitcher();
    return;
  }
  void suspendForCover().then(() => revealWorkspaceSwitcher());
}

function closeWorkspaceSwitcher(): void {
  workspaceSwitcherOpen = false;
  const popup = document.querySelector<HTMLElement>("#workspace-switcher-popup");
  if (popup) {
    popup.hidden = true;
    clearWorkspacePopupPlacement(popup);
  }
  const button = document.querySelector<HTMLButtonElement>("#workspace-switcher-button");
  button?.setAttribute("aria-expanded", "false");
  if (shellCovers.has("switcher")) void releaseCover("switcher");
}

function toggleWorkspaceSwitcher(): void {
  if (workspaceSwitcherOpen || shellCovers.has("switcher")) closeWorkspaceSwitcher();
  else openWorkspaceSwitcher();
}

function paintWorkspaceMark(node: HTMLElement, workspace: Workspace): void {
  const color = workspace.color || DEFAULT_SERVICE_COLOR;
  node.replaceChildren();
  node.classList.remove("glyph", "tile");
  node.style.background = color;
  node.style.color = textColor(color);
  const icon = workspace.icon?.trim() ?? "";
  if (icon.startsWith("local:")) {
    const data = localIconUrls.get(icon);
    if (data) {
      node.classList.add("tile");
      node.style.background = "transparent";
      mountImage(node, [data], () => paintLetter(node, workspace.name, color));
      return;
    }
    paintLetter(node, workspace.name, color);
    return;
  }
  if (icon && isUrl(icon)) {
    node.classList.add("tile");
    node.style.background = "transparent";
    mountImage(node, [icon], () => paintLetter(node, workspace.name, color));
    return;
  }
  if (icon) {
    node.textContent = icon;
    return;
  }
  paintLetter(node, workspace.name, color);
}

function renderSidebar(): void {
  const brand = must<HTMLButtonElement>("#brand-button");
  brand.classList.toggle("current", activeId === null);
  brand.title = t("brand.title", { name: workspaceName() });

  const collapse = must<HTMLButtonElement>("#collapse-button");
  const collapseLabel = sidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse");
  collapse.title = collapseLabel;
  collapse.setAttribute("aria-label", collapseLabel);
  collapse.setAttribute("aria-pressed", sidebarCollapsed ? "true" : "false");
  const chevron = collapse.querySelector("span");
  if (chevron) chevron.textContent = sidebarCollapsed ? "›" : "‹";

  const dnd = must<HTMLButtonElement>("#dnd-button");
  dnd.setAttribute("aria-pressed", doNotDisturb ? "true" : "false");
  dnd.title = doNotDisturb ? t("dnd.on") : t("dnd.off");
  dnd.setAttribute("aria-label", dnd.title);

  paintUpdateChrome();

  const manage = document.querySelector<HTMLButtonElement>("#manage-button");
  if (manage) {
    const label = t("sidebar.addService");
    manage.title = label;
    manage.setAttribute("aria-label", label);
  }

  const railToggle = document.querySelector<HTMLButtonElement>("#rail-toggle-button");
  if (railToggle) {
    const available = workspaces.length > 1;
    railToggle.hidden = !available;
    railToggle.disabled = !available;
    railToggle.setAttribute("aria-pressed", workspaceRailVisible() ? "true" : "false");
    const label = workspaceRailVisible() ? t("sidebar.hideRail") : t("sidebar.showRail");
    railToggle.title = available ? label : t("settings.workspaceRailNeedsSecond");
    railToggle.setAttribute("aria-label", railToggle.title);
  }

  const list = must<HTMLElement>("#service-list");
  list.replaceChildren();
  const shown = visibleServices();
  const empty = document.querySelector<HTMLElement>("#service-empty");
  if (empty) {
    empty.hidden = shown.length > 0;
    const include = empty.querySelector<HTMLButtonElement>("#empty-include-services");
    if (include) include.hidden = services.length === 0;
  }
  list.hidden = shown.length === 0;
  for (const service of shown) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = service.id === activeId ? "svc active" : "svc";
    button.style.setProperty("--svc", service.color);
    button.title = serviceTitle(service);
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", service.id === activeId ? "true" : "false");
    button.draggable = true;
    button.addEventListener("click", () => {
      void activate(service.id);
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      void openServiceMenu(service.id, event.clientX, event.clientY);
    });
    button.addEventListener("dragstart", () => {
      draggingId = service.id;
    });
    button.addEventListener("dragend", () => {
      draggingId = null;
      list.querySelectorAll(".drop-target").forEach((node) => node.classList.remove("drop-target"));
    });
    button.addEventListener("dragover", (event) => {
      event.preventDefault();
      button.classList.add("drop-target");
    });
    button.addEventListener("dragleave", () => button.classList.remove("drop-target"));
    button.addEventListener("drop", (event) => {
      event.preventDefault();
      button.classList.remove("drop-target");
      if (!draggingId || draggingId === service.id) return;
      const ids = services.map((item) => item.id).filter((item) => item !== draggingId);
      const index = ids.indexOf(service.id);
      ids.splice(index, 0, draggingId);
      void run(async () => {
        applySnapshot(await invoke<Snapshot>("reorder_services", { ids }));
      });
    });

    const avatar = document.createElement("span");
    avatar.className = "avatar";
    paintAvatar(avatar, service);
    avatar.classList.toggle("sound-off", soundOff(service));
    const name = document.createElement("span");
    name.className = "svc-name";
    name.textContent = service.name;
    button.append(avatar, name);

    if (service.unread > 0) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.dataset.unreadFor = service.id;
      badge.textContent = service.unread > 99 ? "99+" : String(service.unread);
      button.append(badge);
    }
    list.append(button);
  }
}

function renderStage(): void {
  const dashboard = must<HTMLElement>("#dashboard");
  const status = must<HTMLElement>("#stage-status");
  const active = services.find((service) => service.id === activeId);
  dashboard.hidden = Boolean(active);
  if (!active) renderDashboard();
  if (active) {
    status.hidden = false;
    status.textContent = t("sidebar.opening", { name: active.name });
  } else {
    status.hidden = true;
    status.textContent = "";
  }
}

function renderDashboard(): void {
  must<HTMLElement>("#app-version").textContent = appVersion ? `v${appVersion}` : "";
  paintUpdateChrome();
  const workspace = activeWorkspace();
  must<HTMLElement>("#dash-eyebrow").textContent = workspace ? t("desk.workspaceEyebrow") : t("desk.eyebrow");
  must<HTMLElement>("#dash-title").textContent = workspace ? workspace.name : "rustbox";
  const lede = workspace
    ? workspace.serviceCount === 0
      ? t("desk.emptyShort")
      : t("desk.ledeCount", {
          services: t("count.servicesInWorkspace", { count: workspace.serviceCount }),
        })
    : t("desk.ledeAll");
  must<HTMLElement>("#dash-lede").textContent = lede;

  const toggle = must<HTMLButtonElement>("#dash-scope");
  const scopeRow = must<HTMLElement>("#dash-scope-row");
  const scoped = visibleServices();
  const showToggle = workspace !== undefined && services.length !== scoped.length;
  scopeRow.hidden = !showToggle;
  toggle.hidden = !showToggle;
  const scopeName = workspace?.name ?? t("desk.thisWorkspace");
  toggle.textContent = deskShowAll ? t("desk.scopeOnly", { name: scopeName }) : t("desk.scopeAll");
  toggle.title = deskShowAll ? t("desk.scopeOnlyHint") : t("desk.scopeAllHint");

  const empty = must<HTMLElement>("#dash-empty");
  const grid = must<HTMLElement>("#dash-grid");
  const list = deskShowAll ? services : visibleServices();
  empty.hidden = list.length > 0;
  grid.hidden = list.length === 0;
  grid.replaceChildren();
  for (const service of list) {
    grid.append(serviceCard(service));
  }
  if (empty.hidden) return;

  const emptyText = must<HTMLElement>("#dash-empty-text");
  const include = document.querySelector<HTMLButtonElement>("#dash-empty-include");
  const all = document.querySelector<HTMLButtonElement>("#dash-empty-all");
  if (workspace) {
    emptyText.textContent = t("desk.emptyNamed", { name: workspace.name });
    if (include) include.hidden = false;
    if (all) {
      all.hidden = services.length === 0;
      all.textContent = deskShowAll ? t("desk.scopeOnly", { name: workspace.name }) : t("desk.showAll");
    }
  } else {
    emptyText.textContent = t("desk.emptyPlain");
    if (include) include.hidden = true;
    if (all) all.hidden = true;
  }
}

function serviceCard(service: Service): HTMLElement {
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.serviceId = service.id;

  const main = document.createElement("button");
  main.type = "button";
  main.className = "card-main";
  main.title = t("card.openNamed", { name: service.name });
  const avatar = document.createElement("span");
  avatar.className = "avatar";
  paintAvatar(avatar, service);
  avatar.classList.toggle("sound-off", soundOff(service));
  const copy = document.createElement("span");
  copy.className = "card-copy";
  const name = document.createElement("strong");
  name.textContent = service.name;
  const meta = document.createElement("span");
  meta.dataset.unreadFor = service.id;
  meta.className = service.unread > 0 ? "unread-pill has-unread" : "unread-pill";
  meta.textContent = unreadLabel(service.unread);
  const url = document.createElement("span");
  url.className = "card-url";
  url.textContent = service.url;
  copy.append(name, meta, url);
  const chips = membershipChips(service);
  if (chips && deskShowAll) copy.append(chips);
  main.append(avatar, copy);
  main.addEventListener("click", () => {
    void activate(service.id);
  });

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(
    actionButton(t("card.open"), "open", () => {
      void activate(service.id);
    }),
    actionButton(t("card.edit"), "", () => {
      void openEditor(service);
    }),
    actionButton(t("card.remove"), "danger", () => {
      void confirmRemoveService(service);
    }),
  );

  card.append(main, actions);
  return card;
}

function membershipChips(service: Service): HTMLElement | null {
  if (workspaces.length < 2) return null;
  const row = document.createElement("span");
  row.className = "card-chips";
  if (service.allWorkspaces) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = t("card.allWorkspaces");
    row.append(chip);
    return row;
  }
  for (const workspace of workspaces) {
    if (!service.workspaces.includes(workspace.id)) continue;
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = workspace.name;
    chip.style.borderColor = workspace.color;
    row.append(chip);
  }
  return row.childElementCount > 0 ? row : null;
}

function unreadLabel(count: number): string {
  if (count <= 0) return t("unread.none");
  const shown = count > 99 ? "99+" : String(count);
  return t("count.unread", { count, shown });
}

function actionButton(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  if (className) button.className = className;
  button.addEventListener("click", onClick);
  return button;
}

function brandColorFor(presetId?: string | null): string {
  return presets.find((preset) => preset.id === presetId)?.color || DEFAULT_SERVICE_COLOR;
}

function emptyServiceSeed(): ServiceFormSeed {
  return {
    name: "",
    url: "",
    icon: "",
    color: DEFAULT_SERVICE_COLOR,
    userAgent: "",
    useChromeUserAgent: true,
    preset: null,
    brandColor: DEFAULT_SERVICE_COLOR,
    workspaces: activeWorkspaceId ? [activeWorkspaceId] : [],
    allWorkspaces: false,
  };
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function mountServiceForm(container: HTMLElement): ServiceForm {
  container.replaceChildren();
  const name = field("service.name", "");
  name.input.maxLength = 80;
  const url = field("service.url", "");
  url.input.placeholder = "https://example.com";
  const iconLabel = document.createElement("label");
  iconLabel.className = "wide";
  iconLabel.append(caption("service.icon"));
  const iconRow = document.createElement("div");
  iconRow.className = "icon-row";
  const preview = document.createElement("span");
  preview.className = "avatar icon-preview";
  const file = document.createElement("input");
  file.type = "file";
  file.accept = ".png,.svg,.ico,.jpg,.jpeg,.webp,image/png,image/svg+xml,image/jpeg,image/webp,image/x-icon";
  file.hidden = true;
  const choose = document.createElement("button");
  choose.type = "button";
  choose.className = "file-button";
  choose.dataset.i18n = "service.chooseImage";
  choose.textContent = t("service.chooseImage");
  const iconText = document.createElement("input");
  iconText.type = "text";
  iconText.dataset.i18nPlaceholder = "service.iconPlaceholder";
  iconText.placeholder = t("service.iconPlaceholder");
  iconText.spellcheck = false;
  const resetIcon = document.createElement("button");
  resetIcon.type = "button";
  resetIcon.className = "text-action";
  resetIcon.dataset.i18n = "service.usePreset";
  resetIcon.textContent = t("service.usePreset");
  iconRow.append(preview, choose, file, iconText, resetIcon);
  const iconHint = document.createElement("p");
  iconHint.className = "field-hint";
  iconHint.dataset.i18n = "service.iconHint";
  iconHint.textContent = t("service.iconHint");
  iconLabel.append(iconRow, iconHint);

  const accent = document.createElement("label");
  accent.className = "wide";
  accent.append(caption("service.accent"));
  const accentRow = document.createElement("div");
  accentRow.className = "accent-row";
  const swatch = document.createElement("input");
  swatch.type = "color";
  swatch.value = DEFAULT_SERVICE_COLOR;
  swatch.dataset.i18nAria = "service.accentAria";
  swatch.setAttribute("aria-label", t("service.accentAria"));
  const hex = document.createElement("input");
  hex.type = "text";
  hex.className = "hex-input";
  hex.spellcheck = false;
  hex.value = DEFAULT_SERVICE_COLOR;
  hex.dataset.i18nAria = "service.accentHex";
  hex.setAttribute("aria-label", t("service.accentHex"));
  const brandButton = document.createElement("button");
  brandButton.type = "button";
  brandButton.className = "text-action";
  brandButton.dataset.i18n = "service.brandDefault";
  brandButton.textContent = t("service.brandDefault");
  accentRow.append(swatch, hex, brandButton);
  const accentHint = document.createElement("p");
  accentHint.className = "field-hint";
  accentHint.dataset.i18n = "service.accentHint";
  accentHint.textContent = t("service.accentHint");
  accent.append(accentRow, accentHint);

  const chrome = document.createElement("label");
  chrome.className = "check wide";
  const chromeInput = document.createElement("input");
  chromeInput.type = "checkbox";
  chromeInput.checked = true;
  chrome.append(chromeInput, caption("service.chromeUa"));
  const agent = field("service.customUa", "");
  agent.label.classList.add("wide");
  agent.input.dataset.i18nPlaceholder = "service.customUaPlaceholder";
  agent.input.placeholder = t("service.customUaPlaceholder");

  const membership = document.createElement("fieldset");
  membership.className = "membership wide";
  const legend = document.createElement("legend");
  legend.dataset.i18n = "service.workspaces";
  legend.textContent = t("service.workspaces");
  const membershipHint = document.createElement("p");
  membershipHint.className = "field-hint";
  membershipHint.dataset.i18n = "service.membershipHint";
  membershipHint.textContent = t("service.membershipHint");
  const allRow = document.createElement("label");
  allRow.className = "check";
  const allInput = document.createElement("input");
  allInput.type = "checkbox";
  allRow.append(allInput, caption("service.allWorkspaces"));
  const options = document.createElement("div");
  options.className = "membership-options";
  const membershipError = document.createElement("p");
  membershipError.className = "error";
  membershipError.hidden = true;
  membershipError.dataset.i18n = "service.membershipError";
  membershipError.textContent = t("service.membershipError");
  membership.append(legend, membershipHint, allRow, options, membershipError);

  container.append(
    name.label,
    url.label,
    iconLabel,
    accent,
    chrome,
    agent.label,
    membership,
  );

  type WorkspaceOption = { id: string; input: HTMLInputElement; row: HTMLLabelElement };
  let workspaceOptions: WorkspaceOption[] = [];

  const syncMembership = (): void => {
    const all = allInput.checked;
    for (const option of workspaceOptions) {
      option.input.disabled = all;
      option.row.classList.toggle("disabled", all);
    }
  };

  const buildWorkspaceOptions = (): void => {
    const chosen = new Set(
      workspaceOptions.filter((option) => option.input.checked).map((option) => option.id),
    );
    options.replaceChildren();
    workspaceOptions = [];
    if (workspaces.length <= 1) {
      options.hidden = true;
      return;
    }
    for (const workspace of workspaces) {
      const row = document.createElement("label");
      row.className = "check membership-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = chosen.size === 0 ? workspace.id === activeWorkspaceId : chosen.has(workspace.id);
      input.value = workspace.id;
      const mark = document.createElement("span");
      mark.className = "membership-mark";
      mark.style.background = workspace.color || DEFAULT_SERVICE_COLOR;
      const label = document.createElement("span");
      label.textContent = workspace.name;
      row.append(input, mark, label);
      row.addEventListener("change", syncMembership);
      options.append(row);
      workspaceOptions.push({ id: workspace.id, input, row });
    }
    syncMembership();
  };

  allInput.addEventListener("change", () => {
    if (!allInput.checked && workspaceOptions.every((option) => !option.input.checked)) {
      const fallback =
        workspaceOptions.find((option) => option.id === activeWorkspaceId) ?? workspaceOptions[0];
      if (fallback) fallback.input.checked = true;
    }
    syncMembership();
  });

  const submit = container.id === "editor-fields"
    ? document.querySelector<HTMLButtonElement>("#editor-save")
    : document.querySelector<HTMLButtonElement>("#custom-add");
  const readMembership = (): { workspaces: string[]; allWorkspaces: boolean } => {
    if (allInput.checked) return { workspaces: [], allWorkspaces: true };
    return {
      workspaces: workspaceOptions
        .filter((option) => option.input.checked)
        .map((option) => option.id),
      allWorkspaces: false,
    };
  };
  const membershipValid = (): boolean => {
    const picked = readMembership();
    return picked.allWorkspaces || picked.workspaces.length > 0;
  };
  const syncSubmit = (): void => {
    const ready =
      name.input.value.trim() !== "" && url.input.value.trim() !== "" && membershipValid();
    membershipError.hidden = membershipValid() || !hasInteracted;
    if (submit) submit.disabled = !ready;
  };
  let hasInteracted = false;
  name.input.addEventListener("input", () => {
    hasInteracted = true;
    syncSubmit();
  });
  url.input.addEventListener("input", () => {
    hasInteracted = true;
    syncSubmit();
  });
  options.addEventListener("change", () => {
    hasInteracted = true;
    syncSubmit();
  });
  allInput.addEventListener("change", () => {
    hasInteracted = true;
    syncSubmit();
  });

  let iconValue = "";
  let pendingFile: { bytes: Uint8Array; extension: string; preview: string } | null = null;
  let presetId: string | null = null;
  let pageUrl = "";
  let brandColor = DEFAULT_SERVICE_COLOR;

  const paintPreview = (): void => {
    const draftName = name.input.value || "?";
    const color = swatch.value || DEFAULT_SERVICE_COLOR;
    if (pendingFile) {
      preview.classList.add("tile");
      preview.style.background = "transparent";
      preview.replaceChildren();
      const image = document.createElement("img");
      image.alt = "";
      image.src = pendingFile.preview;
      preview.append(image);
      return;
    }
    paintAvatar(preview, {
      name: draftName,
      color,
      icon: iconValue || null,
      preset: presetId,
      url: pageUrl || url.input.value,
    });
  };

  const setColor = (value: string): void => {
    const next = toColorInput(value);
    swatch.value = next;
    hex.value = next;
    paintPreview();
  };

  name.input.addEventListener("input", paintPreview);
  url.input.addEventListener("input", () => {
    pageUrl = url.input.value;
    paintPreview();
  });
  iconText.addEventListener("input", () => {
    pendingFile = null;
    iconValue = iconText.value.trim();
    paintPreview();
  });
  choose.addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    const picked = file.files?.[0];
    file.value = "";
    if (!picked) return;
    if (picked.size > MAX_ICON_BYTES) {
      showError(t("service.iconTooBig"));
      return;
    }
    const extension = fileExtension(picked.name);
    void picked.arrayBuffer().then((buffer) => {
      pendingFile = {
        bytes: new Uint8Array(buffer),
        extension,
        preview: URL.createObjectURL(picked),
      };
      iconText.value = "";
      paintPreview();
    });
  });
  resetIcon.addEventListener("click", () => {
    pendingFile = null;
    iconValue = "";
    iconText.value = "";
    paintPreview();
  });
  swatch.addEventListener("input", () => {
    hex.value = swatch.value;
    paintPreview();
  });
  hex.addEventListener("change", () => setColor(hex.value));
  brandButton.addEventListener("click", () => setColor(brandColor));

  return {
    set(values) {
      name.input.value = values.name;
      url.input.value = values.url;
      pageUrl = values.url;
      presetId = values.preset ?? null;
      brandColor = values.brandColor || DEFAULT_SERVICE_COLOR;
      iconValue = values.icon?.trim() ?? "";
      pendingFile = null;
      iconText.value = iconValue.startsWith("local:") || iconValue.startsWith("http") ? "" : iconValue;
      if (iconValue.startsWith("http")) iconText.value = iconValue;
      chromeInput.checked = values.useChromeUserAgent;
      agent.input.value = values.userAgent;
      hasInteracted = false;
      setColor(values.color || brandColor);
      allInput.checked = values.allWorkspaces;
      buildWorkspaceOptions();
      for (const option of workspaceOptions) {
        option.input.checked = values.allWorkspaces
          ? false
          : values.workspaces.includes(option.id);
      }
      if (
        !values.allWorkspaces &&
        workspaceOptions.length > 0 &&
        workspaceOptions.every((option) => !option.input.checked)
      ) {
        const fallback =
          workspaceOptions.find((option) => option.id === activeWorkspaceId) ?? workspaceOptions[0];
        if (fallback) fallback.input.checked = true;
      }
      syncMembership();
      syncSubmit();
    },
    reset() {
      this.set(emptyServiceSeed());
    },
    async read() {
      let icon = iconValue;
      if (pendingFile) {
        const bytes = Array.from(pendingFile.bytes);
        const extension = pendingFile.extension;
        const previewUrl = pendingFile.preview;
        icon = await invoke<string>("import_local_icon", { bytes, extension });
        localIconUrls.set(icon, previewUrl);
        iconValue = icon;
        pendingFile = null;
      }
      return {
        name: name.input.value,
        url: url.input.value,
        icon,
        color: swatch.value,
        userAgent: agent.input.value,
        useChromeUserAgent: chromeInput.checked,
        ...readMembership(),
      };
    },
  };
}

function closeEditor(): void {
  editingId = null;
  const dialog = document.querySelector<HTMLDialogElement>("#editor");
  if (dialog?.open) dialog.close();
  if (shellCovers.has("editor")) void releaseCover("editor");
}

async function confirmRemoveService(service: Service): Promise<void> {
  // Held until after the delete so the service webview does not return in the
  // gap between the dialog closing and the session being removed.
  claimCover("confirm-service");
  try {
    const accepted = await confirmDialog({
      title: t("service.removeTitle"),
      message: t("service.removeConfirm", { name: service.name }),
      confirmLabel: t("common.remove"),
      cancelLabel: t("common.cancel"),
      danger: true,
    });
    if (!accepted) return;
    await run(async () => {
      clearError();
      if (editingId === service.id) closeEditor();
      applySnapshot(await invoke<Snapshot>("remove_service", { id: service.id }));
    });
  } finally {
    await releaseCover("confirm-service");
  }
}

async function openEditor(service: Service): Promise<void> {
  claimCover("editor");
  const manager = must<HTMLDialogElement>("#manager");
  if (manager.open) {
    manager.close();
    void releaseCover("manager");
  }
  if (!suspendedId && activeId) await suspendForCover();
  if (!shellCovers.has("editor")) return;
  editingId = service.id;
  if (!editorForm) editorForm = mountServiceForm(must("#editor-fields"));
  if (service.icon?.startsWith("local:") && !localIconUrls.has(service.icon)) {
    await hydrateLocalIcons();
  }
  editorForm.set({
    name: service.name,
    url: service.url,
    icon: service.icon ?? "",
    color: service.color,
    userAgent: service.userAgent ?? "",
    useChromeUserAgent: service.useChromeUserAgent,
    preset: service.preset,
    brandColor: brandColorFor(service.preset),
    workspaces: service.workspaces,
    allWorkspaces: service.allWorkspaces,
  });
  const error = must<HTMLElement>("#editor-error");
  error.hidden = true;
  error.textContent = "";
  must<HTMLDialogElement>("#editor").showModal();
}

let editorSavePending = false;

function syncEditorSave(): void {
  const save = document.querySelector<HTMLButtonElement>("#editor-save");
  if (!save) return;
  save.textContent = editorSavePending ? t("common.saving") : t("common.save");
}

async function saveEditor(serviceId: string): Promise<void> {
  if (!editorForm || editorSavePending) return;
  editorSavePending = true;
  syncEditorSave();
  let snapshot: Snapshot | null = null;
  try {
    const values = await editorForm.read();
    snapshot = await invoke<Snapshot>("update_service", {
      service: {
        id: serviceId,
        name: values.name,
        url: values.url,
        icon: values.icon,
        color: values.color,
        userAgent: values.userAgent,
        useChromeUserAgent: values.useChromeUserAgent,
        workspaces: values.workspaces,
        allWorkspaces: values.allWorkspaces,
      },
    });
  } catch (error) {
    showError(errorText(error));
    return;
  } finally {
    editorSavePending = false;
    syncEditorSave();
  }
  // Close first: a render failure must never leave the dialog trapping the
  // window, and the edit is already saved by this point.
  closeEditor();
  clearError();
  applySnapshot(snapshot);
}

function renderManager(): void {
  renderPresets();
  if (pendingPreset) {
    must<HTMLElement>("#server-url-label").textContent = t("manager.serverUrl", { name: pendingPreset.name });
  }
  must<HTMLElement>("#config-path").textContent = t("manager.config", { path: configPath });
  must<HTMLElement>("#sessions-path").textContent = t("manager.sessions", { path: sessionsDir });
  must<HTMLElement>("#ua-hint").textContent = t("manager.uaHint", { agent: chromeUserAgent });
}

function renderPresets(): void {
  const list = must<HTMLElement>("#preset-list");
  list.replaceChildren();
  for (const preset of presets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset";
    const swatch = document.createElement("span");
    swatch.className = "avatar";
    paintAvatar(swatch, {
      name: preset.name,
      color: preset.color,
      preset: preset.id,
    });
    const label = document.createElement("span");
    label.textContent = preset.name;
    button.append(swatch, label);
    button.addEventListener("click", () => {
      if (preset.requiresServerUrl) {
        pendingPreset = preset;
        const row = must<HTMLElement>("#server-url-row");
        row.hidden = false;
        must<HTMLElement>("#server-url-label").textContent = t("manager.serverUrl", { name: preset.name });
        const input = must<HTMLInputElement>("#server-url");
        input.placeholder = preset.urlHint;
        input.focus();
        return;
      }
      void run(async () => {
        clearError();
        applySnapshot(await invoke<Snapshot>("add_preset", { presetId: preset.id, serverUrl: null }));
      });
    });
    list.append(button);
  }
}

function caption(key: MessageKey): HTMLSpanElement {
  const span = document.createElement("span");
  span.dataset.i18n = key;
  span.textContent = t(key);
  return span;
}

function field(key: MessageKey, value: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.spellcheck = false;
  label.append(caption(key), input);
  return { label, input };
}

type WorkspaceEditorMode = "create" | "rename" | "appearance";
interface WorkspaceDraft {
  mode: WorkspaceEditorMode;
  id: string | null;
  icon: string;
  color: string;
  pendingFile: { bytes: Uint8Array; extension: string; preview: string } | null;
}

let workspaceDraft: WorkspaceDraft | null = null;

function workspaceEditorNodes() {
  return {
    dialog: must<HTMLDialogElement>("#workspace-editor"),
    form: must<HTMLFormElement>("#workspace-form"),
    title: must<HTMLElement>("#workspace-editor-title"),
    name: must<HTMLInputElement>("#workspace-name"),
    icon: must<HTMLInputElement>("#workspace-icon"),
    file: must<HTMLInputElement>("#workspace-file"),
    choose: must<HTMLButtonElement>("#workspace-choose"),
    resetIcon: must<HTMLButtonElement>("#workspace-icon-reset"),
    preview: must<HTMLElement>("#workspace-preview"),
    color: must<HTMLInputElement>("#workspace-color"),
    hex: must<HTMLInputElement>("#workspace-hex"),
    error: must<HTMLElement>("#workspace-error"),
    save: must<HTMLButtonElement>("#workspace-save"),
    includeField: must<HTMLElement>("#workspace-include-field"),
    includeOptions: must<HTMLElement>("#workspace-include-options"),
  };
}

function paintWorkspacePreview(): void {
  if (!workspaceDraft) return;
  const nodes = workspaceEditorNodes();
  const name = nodes.name.value.trim() || t("workspace.fallbackPreview");
  const color = nodes.color.value || DEFAULT_SERVICE_COLOR;
  if (workspaceDraft.pendingFile) {
    nodes.preview.classList.add("tile");
    nodes.preview.classList.remove("glyph");
    nodes.preview.style.background = "transparent";
    nodes.preview.style.color = textColor(color);
    nodes.preview.replaceChildren();
    const image = document.createElement("img");
    image.alt = "";
    image.src = workspaceDraft.pendingFile.preview;
    nodes.preview.append(image);
    return;
  }
  paintAvatar(nodes.preview, {
    name,
    color,
    icon: workspaceDraft.icon || null,
  });
}

function setWorkspaceColor(value: string): void {
  if (!workspaceDraft) return;
  const next = toColorInput(value);
  const nodes = workspaceEditorNodes();
  nodes.color.value = next;
  nodes.hex.value = next;
  workspaceDraft.color = next;
  paintWorkspacePreview();
}

function syncWorkspaceSave(): void {
  const nodes = workspaceEditorNodes();
  nodes.save.disabled = workspaceSavePending || nodes.name.value.trim() === "";
  nodes.save.textContent = workspaceSavePending ? t("common.saving") : t("common.save");
}

/** Tick which existing services the new workspace should also contain. Only
 * shown while creating: adding a workspace should be able to start from
 * services that are already there. */
function renderWorkspaceIncludeOptions(selected: Set<string>): void {
  const nodes = workspaceEditorNodes();
  const create = workspaceDraft?.mode === "create";
  // A service pinned to every workspace already shows in a workspace created
  // later, so offering it would be a checkbox that changes nothing.
  const candidates = create ? services.filter((service) => !service.allWorkspaces) : [];
  nodes.includeField.hidden = candidates.length === 0;
  nodes.includeOptions.replaceChildren();
  if (candidates.length === 0) return;
  for (const service of candidates) {
    const row = document.createElement("label");
    row.className = "check membership-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selected.has(service.id);
    input.value = service.id;
    input.dataset.includeService = service.id;
    const mark = document.createElement("span");
    mark.className = "membership-mark";
    mark.style.background = service.color;
    const label = document.createElement("span");
    label.textContent = service.name;
    row.dataset.includeService = service.id;
    row.append(input, mark, label);
    nodes.includeOptions.append(row);
  }
}

function readWorkspaceIncludeSelection(): string[] {
  const nodes = workspaceEditorNodes();
  return [...nodes.includeOptions.querySelectorAll<HTMLInputElement>("input[data-include-service]")]
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function revealWorkspaceEditor(): void {
  if (!shellCovers.has("workspace-editor") || !workspaceDraft) return;
  const nodes = workspaceEditorNodes();
  if (!nodes.dialog.open) nodes.dialog.showModal();
  if (workspaceDraft.mode === "appearance") {
    nodes.icon.focus();
  } else {
    nodes.name.focus();
    nodes.name.select();
  }
}

function openWorkspaceEditor(workspace: Workspace | null, mode: WorkspaceEditorMode): void {
  const nodes = workspaceEditorNodes();
  workspaceDraft = {
    mode: workspace ? (mode === "create" ? "rename" : mode) : "create",
    id: workspace?.id ?? null,
    icon: workspace?.icon?.trim() ?? "",
    color: workspace?.color || DEFAULT_SERVICE_COLOR,
    pendingFile: null,
  };
  workspaceSavePending = false;
  nodes.title.textContent = workspaceEditorTitle(workspace);
  nodes.name.value = workspace?.name ?? "";
  nodes.icon.value = workspaceDraft.icon;
  nodes.file.value = "";
  nodes.error.hidden = true;
  nodes.error.textContent = "";
  if (workspaceDraft.mode === "appearance") {
    nodes.name.readOnly = true;
  } else {
    nodes.name.readOnly = false;
  }
  renderWorkspaceIncludeOptions(new Set());
  setWorkspaceColor(workspaceDraft.color);
  paintWorkspacePreview();
  syncWorkspaceSave();
  claimCover("workspace-editor");
  if (suspendedId || !activeId) {
    revealWorkspaceEditor();
    return;
  }
  void suspendForCover().then(() => revealWorkspaceEditor());
}

function closeWorkspaceEditor(): void {
  workspaceDraft = null;
  workspaceSavePending = false;
  const nodes = workspaceEditorNodes();
  nodes.name.readOnly = false;
  nodes.includeOptions.replaceChildren();
  nodes.includeField.hidden = true;
  if (nodes.dialog.open) nodes.dialog.close();
  if (shellCovers.has("workspace-editor")) void releaseCover("workspace-editor");
}

async function saveWorkspaceEditor(): Promise<void> {
  const draft = workspaceDraft;
  // A double click, or Enter twice, must not create two workspaces. The save
  // button is disabled while a save is in flight; this guard covers the rest.
  if (!draft || workspaceSavePending) return;
  const nodes = workspaceEditorNodes();
  nodes.error.hidden = true;
  workspaceSavePending = true;
  syncWorkspaceSave();
  let snapshot: Snapshot | null = null;
  try {
    let icon = nodes.icon.value.trim();
    if (draft.pendingFile) {
      const bytes = Array.from(draft.pendingFile.bytes);
      const extension = draft.pendingFile.extension;
      const preview = draft.pendingFile.preview;
      icon = await invoke<string>("import_local_icon", { bytes, extension });
      localIconUrls.set(icon, preview);
      draft.pendingFile = null;
    }
    const color = nodes.color.value;
    const name = nodes.name.value.trim();
    snapshot = draft.id
      ? await invoke<Snapshot>("update_workspace", {
          workspace: { id: draft.id, name, icon: icon || null, color },
        })
      : await invoke<Snapshot>("add_workspace", {
          workspace: {
            name,
            icon: icon || null,
            color,
            includeServices: readWorkspaceIncludeSelection(),
          },
        });
  } catch (error) {
    // The save itself failed, so the dialog stays open for a retry.
    const current = document.querySelector<HTMLElement>("#workspace-error");
    if (current) {
      current.hidden = false;
      current.textContent = errorText(error);
    }
    showError(errorText(error));
    return;
  } finally {
    workspaceSavePending = false;
    if (document.querySelector<HTMLDialogElement>("#workspace-editor")?.open) {
      syncWorkspaceSave();
    }
  }
  // Close before painting the new state. A render failure used to throw out of
  // applySnapshot with the dialog still open, so Save looked broken even though
  // the workspace had been created.
  closeWorkspaceEditor();
  applySnapshot(snapshot);
}

function toColorInput(color: string): string {
  const raw = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  return "#8d8478";
}

interface IncludeNodes {
  dialog: HTMLDialogElement;
  form: HTMLFormElement;
  title: HTMLElement;
  error: HTMLElement;
  hint: HTMLElement;
  options: HTMLElement;
  save: HTMLButtonElement;
}

function includeNodes(): IncludeNodes {
  return {
    dialog: must<HTMLDialogElement>("#include-services"),
    form: must<HTMLFormElement>("#include-form"),
    title: must<HTMLElement>("#include-title"),
    error: must<HTMLElement>("#include-error"),
    hint: must<HTMLElement>("#include-hint"),
    options: must<HTMLElement>("#include-options"),
    save: must<HTMLButtonElement>("#include-save"),
  };
}

/** Services that are not in the target workspace yet, and are not pinned to
 * all of them. Only these can actually be added. */
function includableServices(workspaceId: string | null): Service[] {
  if (!workspaceId) return [];
  return services.filter(
    (service) => !service.allWorkspaces && !service.workspaces.includes(workspaceId),
  );
}

function renderIncludeOptions(workspaceId: string, selected: Set<string>): void {
  const nodes = includeNodes();
  const candidates = includableServices(workspaceId);
  nodes.options.replaceChildren();
  for (const service of candidates) {
    const row = document.createElement("label");
    row.className = "check membership-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selected.has(service.id);
    input.value = service.id;
    input.dataset.includeService = service.id;
    input.addEventListener("change", () => syncIncludeSave());
    const mark = document.createElement("span");
    mark.className = "membership-mark";
    mark.style.background = service.color;
    const label = document.createElement("span");
    label.textContent = service.name;
    row.append(input, mark, label);
    nodes.options.append(row);
  }
  syncIncludeSave();
}

function readIncludeSelection(): string[] {
  return [...includeNodes().options.querySelectorAll<HTMLInputElement>("input[data-include-service]")]
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function syncIncludeSave(): void {
  const nodes = includeNodes();
  nodes.save.disabled = includeServicesPending || readIncludeSelection().length === 0;
  nodes.save.textContent = includeServicesPending ? t("include.adding") : t("include.add");
}

function openIncludeServices(workspaceId: string | null = activeWorkspaceId): void {
  const workspace = workspaces.find((item) => item.id === workspaceId);
  if (!workspaceId || !workspace) {
    showError(t("include.pickFirst"));
    return;
  }
  const candidates = includableServices(workspaceId);
  if (candidates.length === 0) {
    showError(t("include.alreadyIn", { name: workspace.name }));
    return;
  }
  const nodes = includeNodes();
  includeTargetWorkspaceId = workspaceId;
  includeServicesPending = false;
  nodes.title.textContent = t("include.titleNamed", { name: workspace.name });
  nodes.error.hidden = true;
  nodes.error.textContent = "";
  nodes.hint.textContent = includeHint();
  renderIncludeOptions(workspaceId, new Set());
  claimCover("include");
  const reveal = (): void => {
    if (!shellCovers.has("include") || includeTargetWorkspaceId !== workspaceId) return;
    if (!nodes.dialog.open) nodes.dialog.showModal();
  };
  if (suspendedId || !activeId) {
    reveal();
    return;
  }
  void suspendForCover().then(() => reveal());
}

function closeIncludeServices(): void {
  const nodes = document.querySelector<HTMLDialogElement>("#include-services");
  includeTargetWorkspaceId = null;
  includeServicesPending = false;
  if (nodes?.open) nodes.close();
  if (shellCovers.has("include")) void releaseCover("include");
}

async function saveIncludeServices(): Promise<void> {
  const workspaceId = includeTargetWorkspaceId;
  if (!workspaceId || includeServicesPending) return;
  const selection = readIncludeSelection();
  if (selection.length === 0) return;
  const nodes = includeNodes();
  nodes.error.hidden = true;
  includeServicesPending = true;
  syncIncludeSave();
  let snapshot: Snapshot | null = null;
  try {
    snapshot = await invoke<Snapshot>("include_services", {
      workspaceId,
      serviceIds: selection,
    });
  } catch (error) {
    nodes.error.hidden = false;
    nodes.error.textContent = errorText(error);
    showError(errorText(error));
    return;
  } finally {
    includeServicesPending = false;
    if (document.querySelector<HTMLDialogElement>("#include-services")?.open) syncIncludeSave();
  }
  closeIncludeServices();
  applySnapshot(snapshot);
}

async function openManager(): Promise<void> {
  clearError();
  claimCover("manager");
  closeEditor();
  await suspendForCover();
  if (!shellCovers.has("manager")) return;
  renderManager();
  const dialog = must<HTMLDialogElement>("#manager");
  if (!dialog.open) dialog.showModal();
}

async function closeManager(): Promise<void> {
  const dialog = document.querySelector<HTMLDialogElement>("#manager");
  if (dialog?.open) dialog.close();
  if (shellCovers.has("manager")) await releaseCover("manager");
}

function serviceInWorkspace(service: Service, workspaceId: string | null): boolean {
  if (!workspaceId) return true;
  return service.allWorkspaces || service.workspaces.includes(workspaceId);
}

/** Recompute each workspace badge from the service badges it contains. A
 * service shared by two workspaces counts in both, exactly as the backend
 * sums it. A workspace in Do not disturb hides its badge, the same way
 * global Do not disturb hides service badges. */
function recomputeWorkspaceUnread(): void {
  for (const workspace of workspaces) {
    let total = 0;
    for (const service of services) {
      if (serviceInWorkspace(service, workspace.id)) total += service.unread;
    }
    workspace.unread = workspace.dnd ? 0 : total;
  }
}

function refreshUnread(serviceId: string, count: number): void {
  const service = services.find((item) => item.id === serviceId);
  if (!service || service.unread === count) return;
  service.unread = count;
  recomputeWorkspaceUnread();
  const failures = [
    renderStageSafely(t("render.workspaceRail"), renderWorkspaceRail),
    renderStageSafely(t("render.workspaceSwitcher"), renderWorkspaceSwitcher),
    renderStageSafely(t("render.sidebar"), renderSidebar),
  ].filter((message): message is string => message !== null);
  if (failures.length > 0) showError(failures.join(" — "));
  document.querySelectorAll<HTMLElement>(`[data-unread-for="${CSS.escape(serviceId)}"]`).forEach((node) => {
    if (node.classList.contains("badge")) return;
    node.classList.toggle("has-unread", count > 0);
    node.textContent = unreadLabel(count);
  });
}

function soundOff(service: Service): boolean {
  return !doNotDisturb && !service.workspaceSilenced && !service.soundEnabled;
}

function serviceTitle(service: Service): string {
  const parts = [service.unread > 0 ? `${service.name} (${service.unread})` : service.name];
  if (!doNotDisturb && !service.workspaceSilenced && !service.soundEnabled) parts.push(t("service.soundOff"));
  if (!doNotDisturb && !service.workspaceSilenced && !service.notificationsEnabled) {
    parts.push(t("service.notificationsOff"));
  }
  if (service.workspaceSilenced) parts.push(t("service.silenced"));
  return parts.join(". ");
}

async function closeServiceMenu(): Promise<void> {
  const menu = serviceMenu;
  const items = serviceMenuItems;
  serviceMenu = null;
  serviceMenuItems = [];
  if (menu) await menu.close();
  await Promise.all(items.map((item) => item.close()));
}

async function openServiceMenu(serviceId: string, x: number, y: number): Promise<void> {
  try {
    await closeServiceMenu();
    const service = services.find((item) => item.id === serviceId);
    if (!service) return;

    const items: (CheckMenuItem | MenuItem | PredefinedMenuItem)[] = [];
    const add = <T extends CheckMenuItem | MenuItem | PredefinedMenuItem>(item: T): T => {
      items.push(item);
      serviceMenuItems.push(item);
      return item;
    };

    add(await MenuItem.new({ text: service.name, enabled: false }));
    add(await PredefinedMenuItem.new({ item: "Separator" }));
    add(await CheckMenuItem.new({
      text: t("service.menuSound"),
      checked: service.soundEnabled,
      action: () => void setServiceFlag(service.id, "sound", !service.soundEnabled),
    }));
    add(await CheckMenuItem.new({
      text: t("service.menuNotifications"),
      checked: service.notificationsEnabled,
      action: () => void setServiceFlag(service.id, "notifications", !service.notificationsEnabled),
    }));
    add(await PredefinedMenuItem.new({ item: "Separator" }));
    add(await MenuItem.new({
      text: t("service.menuReload"),
      action: () => void run(async () => {
        applySnapshot(await invoke<Snapshot>("reload_service", { id: service.id }));
      }),
    }));
    add(await MenuItem.new({ text: t("service.menuCopyUrl"), action: () => void copyText(service.url) }));
    add(await MenuItem.new({
      text: t("service.menuOpenBrowser"),
      action: () => void run(() => invoke("open_external", { url: service.url })),
    }));

    serviceMenu = await Menu.new({ items });
    await serviceMenu.popup(new LogicalPosition(x, y));
  } catch (error) {
    await closeServiceMenu();
    showError(errorText(error));
  }
}

async function setServiceFlag(id: string, kind: "sound" | "notifications", enabled: boolean): Promise<void> {
  const command = kind === "sound" ? "set_service_sound" : "set_service_notifications";
  const snapshot = await run(() => invoke<Snapshot>(command, { id, enabled }));
  if (snapshot) applySnapshot(snapshot);
}

async function setDoNotDisturb(enabled: boolean): Promise<void> {
  const snapshot = await run(() => invoke<Snapshot>("set_do_not_disturb", { enabled }));
  if (snapshot) applySnapshot(snapshot);
}

async function switchWorkspace(id: string): Promise<void> {
  if (id === activeWorkspaceId) {
    // Clicking the active workspace returns to its desk.
    if (activeId) await showDashboard();
    return;
  }
  clearError();
  closeEditor();
  const snapshot = await run(() => invoke<Snapshot>("set_active_workspace", { id }));
  if (snapshot) applySnapshot(snapshot);
}

async function setWorkspaceDnd(id: string, enabled: boolean): Promise<void> {
  const snapshot = await run(() =>
    invoke<Snapshot>("set_workspace_dnd", { id, enabled }),
  );
  if (snapshot) applySnapshot(snapshot);
}

async function setRailVisible(visible: boolean): Promise<void> {
  const snapshot = await run(() =>
    invoke<Snapshot>("set_workspace_rail_hidden", { hidden: !visible }),
  );
  if (snapshot) applySnapshot(snapshot);
}

async function moveWorkspace(id: string, delta: number): Promise<void> {
  const snapshot = await run(() => invoke<Snapshot>("move_workspace", { id, delta }));
  if (snapshot) applySnapshot(snapshot);
}

async function removeWorkspace(workspace: Workspace): Promise<void> {
  if (workspaces.length <= 1) {
    showError(t("workspace.keepOne"));
    return;
  }
  const fallback =
    workspaces.find((item) => item.id !== workspace.id)?.name ?? t("workspace.first");
  const message = t("workspace.deleteConfirm", { name: workspace.name, fallback });
  // Held across the dialog and the delete. confirmDialog suspends the service
  // webview; releasing this cover afterward puts it back, including on cancel.
  claimCover("confirm-workspace");
  try {
    const accepted = await confirmDialog({
      title: t("workspace.deleteTitle"),
      message,
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      danger: true,
    });
    if (!accepted) return;
    const snapshot = await run(() => invoke<Snapshot>("remove_workspace", { id: workspace.id }));
    if (snapshot) applySnapshot(snapshot);
  } finally {
    await releaseCover("confirm-workspace");
  }
}

async function closeWorkspaceMenu(): Promise<void> {
  const menu = workspaceMenu;
  const items = workspaceMenuItems;
  workspaceMenu = null;
  workspaceMenuItems = [];
  if (menu) await menu.close();
  await Promise.all(items.map((item) => item.close()));
}

async function openWorkspaceMenu(workspaceId: string, x: number, y: number): Promise<void> {
  try {
    await closeWorkspaceMenu();
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return;
    const index = workspaces.findIndex((item) => item.id === workspaceId);

    const items: (MenuItem | PredefinedMenuItem)[] = [];
    const add = <T extends MenuItem | PredefinedMenuItem>(item: T): T => {
      items.push(item);
      workspaceMenuItems.push(item);
      return item;
    };

    add(await MenuItem.new({ text: workspace.name, enabled: false }));
    add(await PredefinedMenuItem.new({ item: "Separator" }));
    add(await MenuItem.new({
      text: t("workspace.menuRename"),
      action: () => deferMenuAction(() => openWorkspaceEditor(workspace, "rename")),
    }));
    add(await MenuItem.new({
      text: t("workspace.menuEdit"),
      action: () => deferMenuAction(() => openWorkspaceEditor(workspace, "appearance")),
    }));
    add(await MenuItem.new({
      text: workspace.dnd ? t("workspace.menuDndOff") : t("dnd.label"),
      action: () => void setWorkspaceDnd(workspace.id, !workspace.dnd),
    }));
    add(await PredefinedMenuItem.new({ item: "Separator" }));
    add(await MenuItem.new({
      text: t("workspace.menuMoveUp"),
      enabled: index > 0,
      action: () => void moveWorkspace(workspace.id, -1),
    }));
    add(await MenuItem.new({
      text: t("workspace.menuMoveDown"),
      enabled: index < workspaces.length - 1,
      action: () => void moveWorkspace(workspace.id, 1),
    }));
    add(await PredefinedMenuItem.new({ item: "Separator" }));
    add(await MenuItem.new({
      text: t("workspace.menuDelete"),
      enabled: workspaces.length > 1,
      action: () => deferMenuAction(() => void removeWorkspace(workspace)),
    }));

    workspaceMenu = await Menu.new({ items });
    await workspaceMenu.popup(new LogicalPosition(x, y));
  } catch (error) {
    await closeWorkspaceMenu();
    showError(errorText(error));
  }
}

async function setLanguage(next: LanguagePreference): Promise<void> {
  const previousPreference = languagePreference;
  const previousLocale = getLocale();
  languagePreference = next;
  const locale = resolveLocale(next, navigator.language, osLocale);
  setLocale(locale);
  document.documentElement.lang = locale;
  render();
  const snapshot = await run(() => invoke<Snapshot>("set_language", { language: next, locale }));
  if (snapshot) applySnapshot(snapshot);
  else {
    languagePreference = previousPreference;
    setLocale(previousLocale);
    document.documentElement.lang = previousLocale;
    render();
  }
}

async function setTheme(next: ThemePreference): Promise<void> {
  const previous = themePreference;
  themePreference = next;
  applyTheme();
  const snapshot = await run(() => invoke<Snapshot>("set_theme", { theme: next }));
  if (snapshot) applySnapshot(snapshot);
  else {
    themePreference = previous;
    applyTheme();
  }
}

async function boot(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) {
    showError(t("boot.viteOnly"));
    return;
  }
  await renderShell();
}

/** Wire the shell and load the first snapshot. Exported so the mocked-backend
 * harness can drive exactly the same code path the app uses. */
export async function renderShell(): Promise<void> {
  mountShell();
  await listen<UnreadEvent>("unread-count", (event) => {
    refreshUnread(event.payload.serviceId, event.payload.count);
  });
  await listen<Snapshot>("app-snapshot", (event) => {
    applySnapshot(event.payload);
  });
  await listen<UpdateStatus>("update-status", (event) => {
    applyUpdateStatus(event.payload);
  });
  await listen("open-update-dialog", () => {
    deferMenuAction(() => openUpdateDialog());
  });

  presets = await invoke<Preset[]>("list_presets");
  const snapshot = await invoke<Snapshot>("get_state");
  applySnapshot(snapshot);
  // Reopen the service that was showing when the app last closed, as long as
  // it still exists and the active workspace can see it. The workspace itself
  // was restored by the backend before this runs.
  const last = services.find((service) => service.id === snapshot.lastServiceId);
  if (!snapshot.activeId && last && serviceInWorkspace(last, activeWorkspaceId)) {
    await activate(last.id);
  }
}

function paintUpdateChrome(): void {
  const badge = document.querySelector<HTMLButtonElement>("#update-badge");
  if (badge) {
    const version = displayVersion(updateStatus.latest);
    const available = updateStatus.state === "available" && version.length > 0;
    badge.hidden = !available;
    const label = available ? t("updates.availableVersion", { version }) : t("updates.checkForUpdates");
    badge.title = label;
    badge.setAttribute("aria-label", label);
  }
  const toggle = document.querySelector<HTMLInputElement>("#auto-update");
  if (toggle) toggle.checked = updateStatus.autoCheck;
  const checked = document.querySelector<HTMLElement>("#update-checked");
  if (checked) checked.textContent = lastCheckedText(updateStatus);
  const check = document.querySelector<HTMLButtonElement>("#check-updates");
  if (check) {
    check.disabled = updateStatus.state === "checking";
    check.textContent = updateStatus.state === "checking" ? t("updates.checkingShort") : t("updates.checkNow");
  }
}

function paintUpdateDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>("#update-dialog");
  if (!dialog) return;
  const version = displayVersion(updateStatus.latest);
  const current = displayVersion(updateStatus.current) || displayVersion(appVersion);
  const versionLine = document.querySelector<HTMLElement>("#update-version");
  if (versionLine) {
    versionLine.textContent = version
      ? t("updates.versionLine", { version, current })
      : "";
  }
  const notes = document.querySelector<HTMLElement>("#update-notes");
  if (notes) paintReleaseNotes(notes);
  const manual = document.querySelector<HTMLElement>("#update-manual");
  const install = document.querySelector<HTMLButtonElement>("#update-install");
  const restart = document.querySelector<HTMLButtonElement>("#update-restart");
  const open = document.querySelector<HTMLButtonElement>("#update-open");
  const skip = document.querySelector<HTMLButtonElement>("#update-skip");
  const ready = updateInstalledVersion !== null && updateInstalledVersion === updateStatus.latest;
  if (manual) {
    manual.hidden = updateStatus.canInstall;
    manual.textContent = updateStatus.canInstall ? "" : t("updates.manual");
  }
  if (install) {
    install.hidden = !updateStatus.canInstall || ready;
    if (!install.disabled) install.textContent = t("updates.download");
  }
  if (restart) restart.hidden = !updateStatus.canInstall || !ready;
  if (open) open.hidden = false;
  if (skip) skip.hidden = !version;
  const error = document.querySelector<HTMLElement>("#update-error");
  if (error && !dialog.open) {
    error.hidden = true;
    error.textContent = "";
  }
}

function paintReleaseNotes(notes: HTMLElement): void {
  const source = updateStatus.notes?.trim() ?? "";
  if (!source) {
    notes.classList.add("is-empty");
    notes.textContent = t("updates.noNotes");
    return;
  }
  notes.classList.remove("is-empty");
  // Markup is limited to headings, lists, emphasis, code, and http(s) links.
  notes.innerHTML = renderReleaseNotes(source);
}

function notesAnchor(event: Event): HTMLAnchorElement | null {
  const notes = event.currentTarget;
  if (!(notes instanceof HTMLElement)) return null;
  const target = event.target;
  if (!(target instanceof Node) || !notes.contains(target)) return null;
  const element = target instanceof Element ? target : target.parentElement;
  const anchor = element?.closest("a");
  if (!(anchor instanceof HTMLAnchorElement) || !notes.contains(anchor)) return null;
  return anchor;
}

function openNotesLink(event: MouseEvent): void {
  const anchor = notesAnchor(event);
  if (!anchor) return;
  event.preventDefault();
  const href = httpUrl(anchor.getAttribute("href"));
  if (!href) return;
  void invoke("open_external", { url: href });
}

function blockNotesNavigation(event: MouseEvent): void {
  const anchor = notesAnchor(event);
  if (!anchor) return;
  event.preventDefault();
}

function openUpdateDialog(): void {
  if (updateStatus.state !== "available" || !updateStatus.latest) return;
  const dialog = document.querySelector<HTMLDialogElement>("#update-dialog");
  if (!dialog) return;
  claimCover("update");
  paintUpdateDialog();
  const reveal = () => {
    if (!shellCovers.has("update")) return;
    paintUpdateDialog();
    if (!dialog.open) dialog.showModal();
  };
  if (suspendedId || !activeId) {
    reveal();
    return;
  }
  void suspendForCover().then(reveal);
}

function closeUpdateDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>("#update-dialog");
  if (dialog?.open) dialog.close();
  if (shellCovers.has("update")) void releaseCover("update");
}

async function checkForUpdates(openWhenFound: boolean): Promise<void> {
  updateStatus = { ...updateStatus, state: "checking" };
  paintUpdateChrome();
  try {
    const status = await invoke<UpdateStatus>("check_for_updates");
    applyUpdateStatus(status);
    if (openWhenFound && status.state === "available") openUpdateDialog();
  } catch {
    updateStatus = { ...updateStatus, state: "error" };
    paintUpdateChrome();
  }
}

async function downloadAndInstall(): Promise<void> {
  const install = document.querySelector<HTMLButtonElement>("#update-install");
  const error = document.querySelector<HTMLElement>("#update-error");
  if (!install || install.disabled || install.hidden) return;
  install.disabled = true;
  install.textContent = t("updates.downloading");
  if (error) {
    error.hidden = true;
    error.textContent = "";
  }
  try {
    await invoke("install_update");
    updateInstalledVersion = updateStatus.latest;
    install.disabled = false;
    install.textContent = t("updates.download");
    paintUpdateDialog();
  } catch (caught) {
    install.disabled = false;
    install.textContent = t("updates.download");
    if (error) {
      error.hidden = false;
      error.textContent = errorText(caught);
    }
  }
}

function applyUpdateStatus(status: UpdateStatus): void {
  updateStatus = status;
  paintUpdateChrome();
  if (document.querySelector<HTMLDialogElement>("#update-dialog")?.open) paintUpdateDialog();
}

function wireEvents(): void {
  must<HTMLButtonElement>("#brand-button").addEventListener("click", () => {
    void showDashboard();
  });
  must<HTMLButtonElement>("#collapse-button").addEventListener("click", () => {
    void setCollapsed(!sidebarCollapsed);
  });
  must<HTMLButtonElement>("#dnd-button").addEventListener("click", () => {
    void setDoNotDisturb(!doNotDisturb);
  });
  must<HTMLSelectElement>("#theme-select").addEventListener("change", (event) => {
    const select = event.currentTarget as HTMLSelectElement;
    if (select.value === "auto" || select.value === "light" || select.value === "dark") {
      void setTheme(select.value);
    }
  });
  must<HTMLSelectElement>("#language-select").addEventListener("change", (event) => {
    const select = event.currentTarget as HTMLSelectElement;
    if (select.value === "system" || select.value === "en" || select.value === "es") {
      void setLanguage(select.value);
    }
  });
  must<HTMLButtonElement>("#manage-button").addEventListener("click", () => {
    void openManager();
  });
  must<HTMLButtonElement>("#dash-add").addEventListener("click", () => {
    void openManager();
  });
  must<HTMLButtonElement>("#dash-workspace-add").addEventListener("click", () => {
    openWorkspaceEditor(null, "create");
  });
  must<HTMLButtonElement>("#workspace-add").addEventListener("click", () => {
    openWorkspaceEditor(null, "create");
  });
  must<HTMLButtonElement>("#dash-scope").addEventListener("click", () => {
    deskShowAll = !deskShowAll;
    renderStage();
  });
  must<HTMLInputElement>("#rail-toggle").addEventListener("change", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    void setRailVisible(input.checked);
  });
  must<HTMLButtonElement>("#rail-toggle-button").addEventListener("click", () => {
    void setRailVisible(!workspaceRailVisible());
  });
  must<HTMLButtonElement>("#workspace-switcher-button").addEventListener("click", () => {
    toggleWorkspaceSwitcher();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!workspaceSwitcherOpen && !shellCovers.has("switcher")) return;
    const container = document.querySelector<HTMLElement>("#workspace-switcher");
    if (container && event.target instanceof Node && container.contains(event.target)) return;
    // A click that opens another shell surface takes over. Restoring the
    // service here would cover that dialog, or fight the click's own activate.
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("#service-list .svc, #brand-button, #manage-button, #dash-add, #dash-workspace-add, #workspace-add, #empty-add-service, #empty-include-services, #dash-empty-add, #dash-empty-include")) {
      suspendedId = null;
    }
    closeWorkspaceSwitcher();
  });
  window.addEventListener("resize", () => {
    if (workspaceSwitcherOpen) placeWorkspacePopup();
  });
  const emptyActions: [string, () => void][] = [
    ["#empty-add-service", () => void openManager()],
    ["#empty-include-services", () => openIncludeServices()],
    ["#dash-empty-add", () => void openManager()],
    ["#dash-empty-include", () => openIncludeServices()],
    [
      "#dash-empty-all",
      () => {
        deskShowAll = !deskShowAll;
        renderStage();
      },
    ],
  ];
  for (const [selector, action] of emptyActions) {
    document.querySelector<HTMLButtonElement>(selector)?.addEventListener("click", action);
  }
  const errorDismiss = document.querySelector<HTMLButtonElement>("#app-error-dismiss");
  errorDismiss?.addEventListener("click", () => clearError());
  const workspaceNodes = workspaceEditorNodes();
  workspaceNodes.choose.addEventListener("click", () => workspaceNodes.file.click());
  workspaceNodes.file.addEventListener("change", () => {
    const picked = workspaceNodes.file.files?.[0];
    workspaceNodes.file.value = "";
    if (!picked || !workspaceDraft) return;
    if (picked.size > MAX_ICON_BYTES) {
      showError(t("service.iconTooBig"));
      return;
    }
    const extension = fileExtension(picked.name);
    void picked.arrayBuffer().then((buffer) => {
      if (!workspaceDraft) return;
      workspaceDraft.pendingFile = {
        bytes: new Uint8Array(buffer),
        extension,
        preview: URL.createObjectURL(picked),
      };
      workspaceNodes.icon.value = "";
      paintWorkspacePreview();
    });
  });
  workspaceNodes.icon.addEventListener("input", () => {
    if (!workspaceDraft) return;
    workspaceDraft.pendingFile = null;
    workspaceDraft.icon = workspaceNodes.icon.value.trim();
    paintWorkspacePreview();
  });
  workspaceNodes.resetIcon.addEventListener("click", () => {
    if (!workspaceDraft) return;
    workspaceDraft.pendingFile = null;
    workspaceDraft.icon = "";
    workspaceNodes.icon.value = "";
    paintWorkspacePreview();
  });
  workspaceNodes.color.addEventListener("input", () => {
    if (!workspaceDraft) return;
    workspaceNodes.hex.value = workspaceNodes.color.value;
    workspaceDraft.color = workspaceNodes.color.value;
    paintWorkspacePreview();
  });
  workspaceNodes.hex.addEventListener("change", () => setWorkspaceColor(workspaceNodes.hex.value));
  workspaceNodes.name.addEventListener("input", () => {
    syncWorkspaceSave();
    paintWorkspacePreview();
  });
  workspaceNodes.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void run(() => saveWorkspaceEditor());
  });
  must<HTMLButtonElement>("#workspace-cancel").addEventListener("click", () =>
    closeWorkspaceEditor(),
  );
  must<HTMLButtonElement>("#workspace-close").addEventListener("click", () =>
    closeWorkspaceEditor(),
  );
  workspaceNodes.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeWorkspaceEditor();
  });
  must<HTMLButtonElement>("#manager-close").addEventListener("click", () => {
    void closeManager();
  });
  must<HTMLDialogElement>("#manager").addEventListener("cancel", (event) => {
    event.preventDefault();
    void closeManager();
  });
  must<HTMLButtonElement>("#server-url-add").addEventListener("click", () => {
    if (!pendingPreset) return;
    const presetId = pendingPreset.id;
    const serverUrl = must<HTMLInputElement>("#server-url").value;
    void run(async () => {
      clearError();
      applySnapshot(await invoke<Snapshot>("add_preset", { presetId, serverUrl }));
      must<HTMLElement>("#server-url-row").hidden = true;
      must<HTMLInputElement>("#server-url").value = "";
      pendingPreset = null;
    });
  });
  const include = includeNodes();
  include.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveIncludeServices();
  });
  must<HTMLButtonElement>("#include-cancel").addEventListener("click", () => closeIncludeServices());
  must<HTMLButtonElement>("#include-close").addEventListener("click", () => closeIncludeServices());
  include.dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeIncludeServices();
  });
  wireConfirmDialog();
  customForm = mountServiceForm(must("#custom-fields"));
  customForm.reset();
  editorForm = mountServiceForm(must("#editor-fields"));
  must<HTMLButtonElement>("#custom-add").addEventListener("click", () => {
    void run(async () => {
      if (!customForm) return;
      clearError();
      const values = await customForm.read();
      const snapshot = await invoke<Snapshot>("add_custom", {
        service: values,
      });
      // Reset the form before painting, so a render failure cannot leave stale
      // values in a dialog that is no longer adding anything.
      customForm.reset();
      applySnapshot(snapshot);
    });
  });
  document.querySelector<HTMLButtonElement>("#update-badge")?.addEventListener("click", () => {
    openUpdateDialog();
  });
  document.querySelector<HTMLButtonElement>("#check-updates")?.addEventListener("click", () => {
    void checkForUpdates(true);
  });
  document.querySelector<HTMLInputElement>("#auto-update")?.addEventListener("change", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    void invoke<Snapshot>("set_update_auto_check", { enabled: input.checked })
      .then((snapshot) => applySnapshot(snapshot))
      .catch(() => {
        input.checked = updateStatus.autoCheck;
      });
  });
  document.querySelector<HTMLButtonElement>("#update-later")?.addEventListener("click", () => {
    closeUpdateDialog();
  });
  document.querySelector<HTMLButtonElement>("#update-close")?.addEventListener("click", () => {
    closeUpdateDialog();
  });
  document.querySelector<HTMLDialogElement>("#update-dialog")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeUpdateDialog();
  });
  document.querySelector<HTMLButtonElement>("#update-skip")?.addEventListener("click", () => {
    const version = updateStatus.latest;
    if (!version) return;
    void invoke<Snapshot>("skip_update", { version })
      .then((snapshot) => {
        closeUpdateDialog();
        applySnapshot(snapshot);
      })
      .catch((caught) => {
        const error = document.querySelector<HTMLElement>("#update-error");
        if (error) {
          error.hidden = false;
          error.textContent = errorText(caught);
        }
      });
  });
  document.querySelector<HTMLButtonElement>("#update-open")?.addEventListener("click", () => {
    const url = updateStatus.url;
    if (!url) return;
    void invoke("open_external", { url });
  });
  const updateNotes = document.querySelector<HTMLElement>("#update-notes");
  updateNotes?.addEventListener("click", openNotesLink);
  updateNotes?.addEventListener("auxclick", blockNotesNavigation);
  document.querySelector<HTMLButtonElement>("#update-install")?.addEventListener("click", () => {
    void downloadAndInstall();
  });
  document.querySelector<HTMLButtonElement>("#update-restart")?.addEventListener("click", () => {
    void invoke("relaunch_app");
  });
  must<HTMLInputElement>("#close-tray").addEventListener("change", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    void run(async () => {
      applySnapshot(await invoke<Snapshot>("set_close_to_tray", { enabled: input.checked }));
    });
  });
  const editor = must<HTMLFormElement>("#editor-form");
  editor.addEventListener("submit", (event) => {
    event.preventDefault();
    const id = editingId;
    if (!id) return;
    void run(() => saveEditor(id));
  });
  must<HTMLButtonElement>("#editor-cancel").addEventListener("click", () => closeEditor());
  must<HTMLButtonElement>("#editor-close").addEventListener("click", () => closeEditor());
  must<HTMLDialogElement>("#editor").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeEditor();
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && (workspaceSwitcherOpen || shellCovers.has("switcher"))) {
        if (!document.querySelector("dialog[open]")) {
          event.preventDefault();
          event.stopPropagation();
          closeWorkspaceSwitcher();
          return;
        }
      }
      if (
        !event.repeat &&
        !event.altKey &&
        !event.shiftKey &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "q"
      ) {
        event.preventDefault();
        event.stopPropagation();
        void invoke("quit_app");
        return;
      }
      if (isWorkspaceShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        const index = Number.parseInt(event.key, 10) - 1;
        const target = workspaces[index];
        if (!target) return;
        void switchWorkspace(target.id);
        return;
      }
      if (!isServiceShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      void run(async () => {
        applySnapshot(
          await invoke<Snapshot>("apply_service_shortcut", {
            key: event.key,
            ctrl: event.ctrlKey,
            meta: event.metaKey,
            shift: event.shiftKey,
            alt: event.altKey,
          }),
        );
      });
    },
    true,
  );
  must<HTMLElement>("#service-list").addEventListener("keydown", (event) => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const list = visibleServices();
    if (list.length === 0) return;
    event.preventDefault();
    const current = list.findIndex((service) => service.id === activeId);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next = list[(current + delta + list.length) % list.length];
    if (next) void activate(next.id);
  });
}

void boot().catch((error: unknown) => showError(errorText(error)));
