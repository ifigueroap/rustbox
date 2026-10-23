import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";

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
  unread: number;
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
  activeId: string | null;
  chromeUserAgent: string;
  configPath: string;
  sessionsDir: string;
  sidebarCollapsed: boolean;
  doNotDisturb: boolean;
  closeToTray: boolean;
  trayAvailable: boolean;
  theme: ThemePreference;
  appVersion: string;
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

let services: Service[] = [];
let presets: Preset[] = [];
let activeId: string | null = null;
let chromeUserAgent = "";
let configPath = "";
let sessionsDir = "";
let sidebarCollapsed = false;
let doNotDisturb = false;
let closeToTray = true;
let trayAvailable = false;
let themePreference: ThemePreference = "auto";
let appVersion = "";
let serviceMenu: Menu | null = null;
let serviceMenuItems: (CheckMenuItem | MenuItem | PredefinedMenuItem)[] = [];
let pendingPreset: Preset | null = null;
let draggingId: string | null = null;
let suspendedId: string | null = null;
let editingId: string | null = null;
const localIconUrls = new Map<string, string>();
const MAX_ICON_BYTES = 1_500_000;

interface ServiceFormValues {
  name: string;
  url: string;
  icon: string;
  color: string;
  userAgent: string;
  useChromeUserAgent: boolean;
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
}

interface ServiceForm {
  read(): Promise<ServiceFormValues>;
  set(values: ServiceFormSeed): void;
  reset(): void;
}

let customForm: ServiceForm | null = null;
let editorForm: ServiceForm | null = null;

function isServiceShortcut(event: KeyboardEvent): boolean {
  if (event.repeat || event.altKey || !(event.ctrlKey || event.metaKey)) return false;
  if (event.key === "Tab") return true;
  if (!event.shiftKey && /^[1-9]$/.test(event.key)) return true;
  return event.shiftKey && event.key.toLowerCase() === "d";
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
  return "Something went wrong";
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

function applySnapshot(snapshot: Snapshot): void {
  services = snapshot.services;
  activeId = snapshot.activeId;
  chromeUserAgent = snapshot.chromeUserAgent;
  configPath = snapshot.configPath;
  sessionsDir = snapshot.sessionsDir;
  sidebarCollapsed = snapshot.sidebarCollapsed;
  doNotDisturb = snapshot.doNotDisturb;
  closeToTray = snapshot.closeToTray;
  trayAvailable = snapshot.trayAvailable;
  themePreference = snapshot.theme;
  appVersion = snapshot.appVersion;
  const closeTray = document.querySelector<HTMLInputElement>("#close-tray");
  if (closeTray) {
    closeTray.checked = closeToTray;
    closeTray.disabled = !trayAvailable;
    closeTray.title = trayAvailable
      ? "Closing the window hides Rustbox and keeps its services running."
      : "The tray icon is not available, so closing the window quits Rustbox.";
  }
  if (editingId && !services.some((service) => service.id === editingId)) closeEditor();
  const active = services.find((service) => service.id === activeId);
  document.title = active ? `${active.name} - Rustbox` : "Rustbox";
  const shell = must<HTMLElement>("#shell");
  shell.classList.toggle("sidebar-collapsed", sidebarCollapsed);
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

function showError(message: string): void {
  for (const selector of ["#manager-error", "#editor-error", "#custom-error"]) {
    const node = document.querySelector<HTMLElement>(selector);
    if (!node) continue;
    node.hidden = false;
    node.textContent = message;
  }
  const stage = must<HTMLElement>("#stage-status");
  stage.hidden = false;
  stage.dataset.error = "true";
  stage.textContent = message;
}

function clearError(): void {
  for (const selector of ["#manager-error", "#editor-error", "#custom-error"]) {
    const node = document.querySelector<HTMLElement>(selector);
    if (!node) continue;
    node.hidden = true;
    node.textContent = "";
  }
  const stage = must<HTMLElement>("#stage-status");
  delete stage.dataset.error;
}

async function activate(id: string): Promise<void> {
  clearError();
  closeEditor();
  const snapshot = await run(() => invoke<Snapshot>("set_active_service", { id }));
  if (snapshot) applySnapshot(snapshot);
}

async function showDashboard(): Promise<void> {
  clearError();
  if (!activeId) {
    render();
    return;
  }
  const snapshot = await run(() => invoke<Snapshot>("set_active_service", { id: null }));
  if (snapshot) applySnapshot(snapshot);
}

async function setCollapsed(collapsed: boolean): Promise<void> {
  const shell = must<HTMLElement>("#shell");
  shell.classList.toggle("sidebar-collapsed", collapsed);
  const snapshot = await run(() => invoke<Snapshot>("set_sidebar_collapsed", { collapsed }));
  if (snapshot) applySnapshot(snapshot);
  else shell.classList.toggle("sidebar-collapsed", sidebarCollapsed);
}

function render(): void {
  renderSidebar();
  renderStage();
  if (must<HTMLDialogElement>("#manager").open) renderManager();
}

function renderSidebar(): void {
  const brand = must<HTMLButtonElement>("#brand-button");
  brand.classList.toggle("current", activeId === null);
  brand.title = "rustbox";

  const collapse = must<HTMLButtonElement>("#collapse-button");
  const collapseLabel = sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
  collapse.title = collapseLabel;
  collapse.setAttribute("aria-label", collapseLabel);
  collapse.setAttribute("aria-pressed", sidebarCollapsed ? "true" : "false");
  const chevron = collapse.querySelector("span");
  if (chevron) chevron.textContent = sidebarCollapsed ? "›" : "‹";

  const dnd = must<HTMLButtonElement>("#dnd-button");
  dnd.setAttribute("aria-pressed", doNotDisturb ? "true" : "false");
  dnd.title = doNotDisturb
    ? "Do not disturb is on. Click to turn it off."
    : "Pause sounds and notifications for every service.";
  dnd.setAttribute("aria-label", dnd.title);

  const list = must<HTMLElement>("#service-list");
  list.replaceChildren();
  for (const service of services) {
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
  if (status.dataset.error === "true") return;
  if (active) {
    status.hidden = false;
    status.textContent = `Opening ${active.name}`;
  } else {
    status.hidden = true;
    status.textContent = "";
  }
}

function renderDashboard(): void {
  must<HTMLElement>("#app-version").textContent = appVersion ? `v${appVersion}` : "";
  const grid = must<HTMLElement>("#dash-grid");
  const empty = must<HTMLElement>("#dash-empty");
  empty.hidden = services.length > 0;
  grid.replaceChildren();
  for (const service of services) {
    grid.append(serviceCard(service));
  }
}

function serviceCard(service: Service): HTMLElement {
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.serviceId = service.id;

  const main = document.createElement("button");
  main.type = "button";
  main.className = "card-main";
  main.title = `Open ${service.name}`;
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
  main.append(avatar, copy);
  main.addEventListener("click", () => {
    void activate(service.id);
  });

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(
    actionButton("Open", "open", () => {
      void activate(service.id);
    }),
    actionButton("Edit", "", () => {
      void openEditor(service);
    }),
    actionButton("Remove", "danger", () => {
      if (!window.confirm(`Remove ${service.name}? Its saved session will be deleted.`)) return;
      void run(async () => {
        clearError();
        if (editingId === service.id) closeEditor();
        applySnapshot(await invoke<Snapshot>("remove_service", { id: service.id }));
      });
    }),
  );

  card.append(main, actions);
  return card;
}

function unreadLabel(count: number): string {
  if (count <= 0) return "No unread";
  if (count === 1) return "1 unread";
  return `${count > 99 ? "99+" : count} unread`;
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
  };
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function mountServiceForm(container: HTMLElement): ServiceForm {
  container.replaceChildren();
  const name = field("Name", "");
  name.input.maxLength = 80;
  const url = field("URL", "");
  url.input.placeholder = "https://example.com";
  const iconLabel = document.createElement("label");
  iconLabel.className = "wide";
  iconLabel.append("Icon");
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
  choose.textContent = "Choose image";
  const iconText = document.createElement("input");
  iconText.type = "text";
  iconText.placeholder = "URL or emoji";
  iconText.spellcheck = false;
  const resetIcon = document.createElement("button");
  resetIcon.type = "button";
  resetIcon.className = "text-action";
  resetIcon.textContent = "Use preset or favicon";
  iconRow.append(preview, choose, file, iconText, resetIcon);
  const iconHint = document.createElement("p");
  iconHint.className = "field-hint";
  iconHint.textContent = "PNG, SVG, ICO, JPG, or WebP. Rustbox copies the image into its own data folder.";
  iconLabel.append(iconRow, iconHint);

  const accent = document.createElement("label");
  accent.className = "wide";
  accent.append("Accent color");
  const accentRow = document.createElement("div");
  accentRow.className = "accent-row";
  const swatch = document.createElement("input");
  swatch.type = "color";
  swatch.value = DEFAULT_SERVICE_COLOR;
  swatch.setAttribute("aria-label", "Accent color");
  const hex = document.createElement("input");
  hex.type = "text";
  hex.className = "hex-input";
  hex.spellcheck = false;
  hex.value = DEFAULT_SERVICE_COLOR;
  hex.setAttribute("aria-label", "Accent color hex");
  const brandButton = document.createElement("button");
  brandButton.type = "button";
  brandButton.className = "text-action";
  brandButton.textContent = "Use brand default";
  accentRow.append(swatch, hex, brandButton);
  const accentHint = document.createElement("p");
  accentHint.className = "field-hint";
  accentHint.textContent =
    "Used for the sidebar highlight and the letter fallback. A full-color icon keeps its own colors.";
  accent.append(accentRow, accentHint);

  const chrome = document.createElement("label");
  chrome.className = "check wide";
  const chromeInput = document.createElement("input");
  chromeInput.type = "checkbox";
  chromeInput.checked = true;
  chrome.append(chromeInput, document.createTextNode("Use a Chrome user agent"));
  const agent = field("Custom user agent", "");
  agent.label.classList.add("wide");
  agent.input.placeholder = "Leave blank for the built-in Chrome string";

  container.append(name.label, url.label, iconLabel, accent, chrome, agent.label);

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
      showError("Icon file must be under 1.5 MB.");
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
      setColor(values.color || brandColor);
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
      };
    },
  };
}

function closeEditor(): void {
  editingId = null;
  const dialog = document.querySelector<HTMLDialogElement>("#editor");
  if (dialog?.open) dialog.close();
}

async function openEditor(service: Service): Promise<void> {
  const manager = must<HTMLDialogElement>("#manager");
  if (manager.open) {
    manager.close();
    suspendedId = null;
  }
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
  });
  const error = must<HTMLElement>("#editor-error");
  error.hidden = true;
  error.textContent = "";
  must<HTMLDialogElement>("#editor").showModal();
}

async function saveEditor(serviceId: string): Promise<void> {
  if (!editorForm) return;
  const values = await editorForm.read();
  clearError();
  applySnapshot(
    await invoke<Snapshot>("update_service", {
      service: {
        id: serviceId,
        name: values.name,
        url: values.url,
        icon: values.icon,
        color: values.color,
        userAgent: values.userAgent,
        useChromeUserAgent: values.useChromeUserAgent,
      },
    }),
  );
  closeEditor();
}

function renderManager(): void {
  renderPresets();
  must<HTMLElement>("#config-path").textContent = `Config: ${configPath}`;
  must<HTMLElement>("#sessions-path").textContent = `Sessions: ${sessionsDir}`;
  must<HTMLElement>("#ua-hint").textContent = `Built-in Chrome user agent: ${chromeUserAgent}`;
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
        must<HTMLElement>("#server-url-label").textContent = `${preset.name} server URL`;
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

function field(labelText: string, value: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.spellcheck = false;
  label.append(input);
  return { label, input };
}

function toColorInput(color: string): string {
  const raw = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  return "#8d8478";
}

async function openManager(): Promise<void> {
  clearError();
  closeEditor();
  if (activeId) {
    suspendedId = activeId;
    const snapshot = await run(() => invoke<Snapshot>("set_active_service", { id: null }));
    if (snapshot) applySnapshot(snapshot);
  }
  renderManager();
  must<HTMLDialogElement>("#manager").showModal();
}

async function closeManager(): Promise<void> {
  must<HTMLDialogElement>("#manager").close();
  const restore = suspendedId;
  suspendedId = null;
  if (restore && services.some((service) => service.id === restore)) {
    await activate(restore);
  }
}

function refreshUnread(serviceId: string, count: number): void {
  const service = services.find((item) => item.id === serviceId);
  if (!service || service.unread === count) return;
  service.unread = count;
  renderSidebar();
  document.querySelectorAll<HTMLElement>(`[data-unread-for="${CSS.escape(serviceId)}"]`).forEach((node) => {
    if (node.classList.contains("badge")) return;
    node.classList.toggle("has-unread", count > 0);
    node.textContent = unreadLabel(count);
  });
}

function soundOff(service: Service): boolean {
  return !doNotDisturb && !service.soundEnabled;
}

function serviceTitle(service: Service): string {
  const parts = [service.unread > 0 ? `${service.name} (${service.unread})` : service.name];
  if (!doNotDisturb && !service.soundEnabled) parts.push("Sound off");
  if (!doNotDisturb && !service.notificationsEnabled) parts.push("Notifications off");
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
      text: "Sound",
      checked: service.soundEnabled,
      action: () => void setServiceFlag(service.id, "sound", !service.soundEnabled),
    }));
    add(await CheckMenuItem.new({
      text: "Notifications",
      checked: service.notificationsEnabled,
      action: () => void setServiceFlag(service.id, "notifications", !service.notificationsEnabled),
    }));
    add(await PredefinedMenuItem.new({ item: "Separator" }));
    add(await MenuItem.new({
      text: "Reload",
      action: () => void run(async () => {
        applySnapshot(await invoke<Snapshot>("reload_service", { id: service.id }));
      }),
    }));
    add(await MenuItem.new({ text: "Copy URL", action: () => void copyText(service.url) }));
    add(await MenuItem.new({
      text: "Open in browser",
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
    showError("Open this window from the Rustbox app. The Vite page alone cannot host service webviews.");
    return;
  }
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
  must<HTMLButtonElement>("#manage-button").addEventListener("click", () => {
    void openManager();
  });
  must<HTMLButtonElement>("#dash-add").addEventListener("click", () => {
    void openManager();
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
  customForm = mountServiceForm(must("#custom-fields"));
  customForm.reset();
  editorForm = mountServiceForm(must("#editor-fields"));
  must<HTMLButtonElement>("#custom-add").addEventListener("click", () => {
    void run(async () => {
      if (!customForm) return;
      clearError();
      const values = await customForm.read();
      applySnapshot(
        await invoke<Snapshot>("add_custom", {
          service: values,
        }),
      );
      customForm.reset();
    });
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
    if (services.length === 0) return;
    event.preventDefault();
    const current = services.findIndex((service) => service.id === activeId);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next = services[(current + delta + services.length) % services.length];
    if (next) void activate(next.id);
  });

  await listen<UnreadEvent>("unread-count", (event) => {
    refreshUnread(event.payload.serviceId, event.payload.count);
  });
  await listen<Snapshot>("app-snapshot", (event) => {
    applySnapshot(event.payload);
  });

  presets = await invoke<Preset[]>("list_presets");
  applySnapshot(await invoke<Snapshot>("get_state"));
}

void boot().catch((error: unknown) => showError(errorText(error)));
