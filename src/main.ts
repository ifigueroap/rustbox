import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Service {
  id: string;
  name: string;
  url: string;
  icon?: string | null;
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
  appVersion: string;
}

interface UnreadEvent {
  serviceId: string;
  count: number;
}

interface IconTarget {
  name: string;
  color: string;
  icon?: string | null;
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
let appVersion = "";
let menuServiceId: string | null = null;
let pendingPreset: Preset | null = null;
let draggingId: string | null = null;
let suspendedId: string | null = null;
let editingId: string | null = null;

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
  appVersion = snapshot.appVersion;
  if (editingId && !services.some((service) => service.id === editingId)) editingId = null;
  const active = services.find((service) => service.id === activeId);
  document.title = active ? `${active.name} - Rustbox` : "Rustbox";
  const shell = must<HTMLElement>("#shell");
  shell.classList.toggle("sidebar-collapsed", sidebarCollapsed);
  shell.classList.toggle("dnd-on", doNotDisturb);
  render();
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
  const managerError = must<HTMLElement>("#manager-error");
  const stage = must<HTMLElement>("#stage-status");
  managerError.hidden = false;
  managerError.textContent = message;
  stage.hidden = false;
  stage.dataset.error = "true";
  stage.textContent = message;
}

function clearError(): void {
  const managerError = must<HTMLElement>("#manager-error");
  managerError.hidden = true;
  managerError.textContent = "";
  const stage = must<HTMLElement>("#stage-status");
  delete stage.dataset.error;
}

async function activate(id: string): Promise<void> {
  clearError();
  editingId = null;
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
  dnd.classList.toggle("is-on", doNotDisturb);
  dnd.setAttribute("aria-pressed", doNotDisturb ? "true" : "false");
  const dndText = doNotDisturb ? "Do not disturb is on" : "Do not disturb";
  dnd.title = doNotDisturb
    ? "Do not disturb is on. Sounds and notifications are paused for every service."
    : "Pause sounds and notifications for every service.";
  dnd.setAttribute("aria-label", dnd.title);
  const dndLabel = dnd.querySelector(".dnd-label");
  if (dndLabel) dndLabel.textContent = dndText;

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
      openServiceMenu(service.id, event.clientX, event.clientY);
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
  updateServiceMenu();
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
  meta.className = "unread-pill";
  meta.hidden = service.unread <= 0;
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
      editingId = editingId === service.id ? null : service.id;
      renderDashboard();
    }),
    actionButton("Remove", "danger", () => {
      if (!window.confirm(`Remove ${service.name}? Its saved session will be deleted.`)) return;
      void run(async () => {
        clearError();
        if (editingId === service.id) editingId = null;
        applySnapshot(await invoke<Snapshot>("remove_service", { id: service.id }));
      });
    }),
  );

  card.append(main, actions);
  if (editingId === service.id) card.append(serviceEditor(service));
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

function serviceEditor(service: Service): HTMLElement {
  const form = document.createElement("div");
  form.className = "card-editor";
  const name = field("Name", service.name);
  const url = field("URL", service.url);
  const icon = field("Icon", service.icon ?? "");
  const color = document.createElement("input");
  color.type = "color";
  color.value = toColorInput(service.color);
  color.setAttribute("aria-label", "Color");
  const chrome = document.createElement("label");
  chrome.className = "check";
  const chromeInput = document.createElement("input");
  chromeInput.type = "checkbox";
  chromeInput.checked = service.useChromeUserAgent;
  chrome.append(chromeInput, document.createTextNode("Use a Chrome user agent"));
  const agent = field("Custom user agent", service.userAgent ?? "");
  const actions = document.createElement("div");
  actions.className = "editor-actions";
  const save = actionButton("Save", "row-button", () => {
    void run(async () => {
      clearError();
      applySnapshot(
        await invoke<Snapshot>("update_service", {
          service: {
            id: service.id,
            name: name.input.value,
            url: url.input.value,
            icon: icon.input.value,
            color: color.value,
            userAgent: agent.input.value,
            useChromeUserAgent: chromeInput.checked,
          },
        }),
      );
      editingId = null;
      renderDashboard();
    });
  });
  const cancel = actionButton("Cancel", "", () => {
    editingId = null;
    renderDashboard();
  });
  actions.append(save, cancel);
  form.append(name.label, url.label, icon.label, color, chrome, agent.label, actions);
  return form;
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
  if (activeId === null && editingId === null) renderDashboard();
  else {
    document.querySelectorAll<HTMLElement>(`[data-unread-for="${CSS.escape(serviceId)}"]`).forEach((node) => {
      if (node.classList.contains("badge")) {
        node.textContent = count > 99 ? "99+" : String(count);
        node.hidden = count <= 0;
      } else {
        node.hidden = count <= 0;
        node.textContent = unreadLabel(count);
      }
    });
  }
}

function soundOff(service: Service): boolean {
  return doNotDisturb || !service.soundEnabled;
}

function serviceTitle(service: Service): string {
  const parts = [service.unread > 0 ? `${service.name} (${service.unread})` : service.name];
  if (doNotDisturb) parts.push("Paused by Do not disturb");
  else {
    if (!service.soundEnabled) parts.push("Sound off");
    if (!service.notificationsEnabled) parts.push("Notifications off");
  }
  return parts.join(". ");
}

function openServiceMenu(serviceId: string, x: number, y: number): void {
  menuServiceId = serviceId;
  const menu = must<HTMLElement>("#service-menu");
  menu.hidden = false;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  updateServiceMenu();
  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function closeServiceMenu(): void {
  menuServiceId = null;
  const menu = document.querySelector<HTMLElement>("#service-menu");
  if (menu) menu.hidden = true;
}

function updateServiceMenu(): void {
  const menu = document.querySelector<HTMLElement>("#service-menu");
  if (!menu || menu.hidden || !menuServiceId) return;
  const service = services.find((item) => item.id === menuServiceId);
  if (!service) {
    closeServiceMenu();
    return;
  }
  must<HTMLElement>("#service-menu-title").textContent = service.name;
  const sound = must<HTMLButtonElement>("#service-menu-sound");
  const notes = must<HTMLButtonElement>("#service-menu-notes");
  sound.setAttribute("aria-checked", service.soundEnabled ? "true" : "false");
  notes.setAttribute("aria-checked", service.notificationsEnabled ? "true" : "false");
  sound.textContent = service.soundEnabled ? "Sound on" : "Sound off";
  notes.textContent = service.notificationsEnabled ? "Notifications on" : "Notifications off";
  const hint = must<HTMLElement>("#service-menu-note");
  hint.hidden = !doNotDisturb;
}

async function setServiceFlag(id: string, kind: "sound" | "notifications", enabled: boolean): Promise<void> {
  const command = kind === "sound" ? "set_service_sound" : "set_service_notifications";
  const snapshot = await run(() => invoke<Snapshot>(command, { id, enabled }));
  if (snapshot) applySnapshot(snapshot);
}

async function setDoNotDisturb(enabled: boolean): Promise<void> {
  const shell = must<HTMLElement>("#shell");
  shell.classList.toggle("dnd-on", enabled);
  const snapshot = await run(() => invoke<Snapshot>("set_do_not_disturb", { enabled }));
  if (snapshot) applySnapshot(snapshot);
  else shell.classList.toggle("dnd-on", doNotDisturb);
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
  must<HTMLButtonElement>("#service-menu-sound").addEventListener("click", () => {
    const service = services.find((item) => item.id === menuServiceId);
    if (service) void setServiceFlag(service.id, "sound", !service.soundEnabled);
  });
  must<HTMLButtonElement>("#service-menu-notes").addEventListener("click", () => {
    const service = services.find((item) => item.id === menuServiceId);
    if (service) void setServiceFlag(service.id, "notifications", !service.notificationsEnabled);
  });
  must<HTMLButtonElement>("#service-menu-reload").addEventListener("click", () => {
    const id = menuServiceId;
    if (!id) return;
    closeServiceMenu();
    void run(async () => {
      applySnapshot(await invoke<Snapshot>("reload_service", { id }));
    });
  });
  must<HTMLButtonElement>("#service-menu-copy").addEventListener("click", () => {
    const service = services.find((item) => item.id === menuServiceId);
    if (!service) return;
    closeServiceMenu();
    void copyText(service.url);
  });
  must<HTMLButtonElement>("#service-menu-browser").addEventListener("click", () => {
    const service = services.find((item) => item.id === menuServiceId);
    if (!service) return;
    closeServiceMenu();
    void run(() => invoke("open_external", { url: service.url }));
  });
  const menu = must<HTMLElement>("#service-menu");
  menu.addEventListener("contextmenu", (event) => event.preventDefault());
  document.addEventListener("pointerdown", (event) => {
    if (menu.hidden) return;
    if (event.target instanceof Node && menu.contains(event.target)) return;
    closeServiceMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeServiceMenu();
  });
  window.addEventListener("resize", () => closeServiceMenu());
  must<HTMLElement>("#service-list").addEventListener("scroll", () => closeServiceMenu());
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
  must<HTMLButtonElement>("#custom-add").addEventListener("click", () => {
    void run(async () => {
      clearError();
      applySnapshot(
        await invoke<Snapshot>("add_custom", {
          service: {
            name: must<HTMLInputElement>("#custom-name").value,
            url: must<HTMLInputElement>("#custom-url").value,
            icon: must<HTMLInputElement>("#custom-icon").value,
            color: must<HTMLInputElement>("#custom-color").value,
            userAgent: must<HTMLInputElement>("#custom-ua").value,
            useChromeUserAgent: must<HTMLInputElement>("#custom-chrome").checked,
          },
        }),
      );
      must<HTMLInputElement>("#custom-name").value = "";
      must<HTMLInputElement>("#custom-url").value = "";
      must<HTMLInputElement>("#custom-icon").value = "";
      must<HTMLInputElement>("#custom-ua").value = "";
    });
  });
  window.addEventListener(
    "keydown",
    (event) => {
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
