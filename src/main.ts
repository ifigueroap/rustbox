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
}

interface UnreadEvent {
  serviceId: string;
  count: number;
}

let services: Service[] = [];
let presets: Preset[] = [];
let activeId: string | null = null;
let chromeUserAgent = "";
let configPath = "";
let sessionsDir = "";
let pendingPreset: Preset | null = null;
let draggingId: string | null = null;
let suspendedId: string | null = null;

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

function applySnapshot(snapshot: Snapshot): void {
  services = snapshot.services;
  activeId = snapshot.activeId;
  chromeUserAgent = snapshot.chromeUserAgent;
  configPath = snapshot.configPath;
  sessionsDir = snapshot.sessionsDir;
  const active = services.find((service) => service.id === activeId);
  document.title = active ? `${active.name} - Rustbox` : "Rustbox";
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
  const snapshot = await run(() => invoke<Snapshot>("set_active_service", { id }));
  if (snapshot) applySnapshot(snapshot);
}

function render(): void {
  renderSidebar();
  renderStage();
  if (must<HTMLDialogElement>("#manager").open) renderManager();
}

function renderSidebar(): void {
  const list = must<HTMLElement>("#service-list");
  list.replaceChildren();
  for (const service of services) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = service.id === activeId ? "svc active" : "svc";
    button.style.setProperty("--svc", service.color);
    button.title = service.unread > 0 ? `${service.name} (${service.unread})` : service.name;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", service.id === activeId ? "true" : "false");
    button.draggable = true;
    button.addEventListener("click", () => {
      void activate(service.id);
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
    avatar.style.background = service.color;
    avatar.style.color = textColor(service.color);
    const icon = service.icon?.trim();
    if (icon && isUrl(icon)) {
      const image = document.createElement("img");
      image.alt = "";
      image.draggable = false;
      image.src = icon;
      image.addEventListener("error", () => {
        image.replaceWith(document.createTextNode(initial(service.name)));
      });
      avatar.append(image);
    } else {
      avatar.textContent = icon || initial(service.name);
    }
    button.append(avatar);

    if (service.unread > 0) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = service.unread > 99 ? "99+" : String(service.unread);
      button.append(badge);
    }
    list.append(button);
  }
}

function renderStage(): void {
  const empty = must<HTMLElement>("#empty");
  const status = must<HTMLElement>("#stage-status");
  const active = services.find((service) => service.id === activeId);
  empty.hidden = Boolean(active);
  if (status.dataset.error === "true") return;
  if (active) {
    status.hidden = false;
    status.textContent = `Opening ${active.name}`;
  } else {
    status.hidden = true;
    status.textContent = "";
  }
}

function renderManager(): void {
  renderPresets();
  renderManaged();
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
    swatch.style.background = preset.color;
    swatch.style.color = textColor(preset.color);
    swatch.textContent = initial(preset.name);
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
        applySnapshot(
          await invoke<Snapshot>("add_preset", { presetId: preset.id, serverUrl: null }),
        );
      });
    });
    list.append(button);
  }
}

function renderManaged(): void {
  const list = must<HTMLElement>("#managed-list");
  list.replaceChildren();
  if (services.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-desk";
    empty.textContent = "No services yet. Add a preset or a custom URL.";
    list.append(empty);
    return;
  }
  services.forEach((service, index) => {
    list.append(serviceRow(service, index));
  });
}

function serviceRow(service: Service, index: number): HTMLElement {
  const row = document.createElement("article");
  row.className = "managed";

  const order = document.createElement("div");
  order.className = "order-buttons";
  order.append(
    orderButton("↑", "Move up", index === 0, () => move(index, -1)),
    orderButton("↓", "Move down", index === services.length - 1, () => move(index, 1)),
  );

  const fields = document.createElement("div");
  fields.className = "fields";
  const name = field("Name", service.name);
  const url = field("URL", service.url);
  const icon = field("Icon", service.icon ?? "");
  const color = document.createElement("input");
  color.type = "color";
  color.value = toColorInput(service.color);
  const chrome = document.createElement("label");
  chrome.className = "check";
  const chromeInput = document.createElement("input");
  chromeInput.type = "checkbox";
  chromeInput.checked = service.useChromeUserAgent;
  chrome.append(chromeInput, document.createTextNode("Use a Chrome user agent"));
  const agent = field("Custom user agent", service.userAgent ?? "");
  fields.append(name.label, url.label, icon.label, color, chrome, agent.label);

  const actions = document.createElement("div");
  actions.className = "row-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "row-button";
  save.textContent = "Save";
  save.addEventListener("click", () => {
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
    });
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    if (!window.confirm(`Remove ${service.name}? Its saved session will be deleted.`)) return;
    void run(async () => {
      clearError();
      applySnapshot(await invoke<Snapshot>("remove_service", { id: service.id }));
    });
  });
  actions.append(save, remove);
  row.append(order, fields, actions);
  return row;
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

function orderButton(text: string, title: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.title = title;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function move(index: number, delta: number): void {
  const ids = services.map((service) => service.id);
  const next = index + delta;
  if (next < 0 || next >= ids.length) return;
  const [id] = ids.splice(index, 1);
  if (!id) return;
  ids.splice(next, 0, id);
  void run(async () => {
    clearError();
    applySnapshot(await invoke<Snapshot>("reorder_services", { ids }));
  });
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

async function boot(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) {
    showError("Open this window from the Rustbox app. The Vite page alone cannot host service webviews.");
    return;
  }
  must<HTMLButtonElement>("#manage-button").addEventListener("click", () => {
    void openManager();
  });
  must<HTMLButtonElement>("#empty-add").addEventListener("click", () => {
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
      applySnapshot(
        await invoke<Snapshot>("add_preset", {
          presetId,
          serverUrl,
        }),
      );
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
    const service = services.find((item) => item.id === event.payload.serviceId);
    if (!service || service.unread === event.payload.count) return;
    service.unread = event.payload.count;
    renderSidebar();
  });

  presets = await invoke<Preset[]>("list_presets");
  applySnapshot(await invoke<Snapshot>("get_state"));
}

void boot().catch((error: unknown) => showError(errorText(error)));
