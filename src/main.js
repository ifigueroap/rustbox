import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const servicesEl = document.querySelector("#services");
const catalogEl = document.querySelector("#catalog");
const editorEl = document.querySelector("#editor");
const stageEl = document.querySelector("#stage");
const errorEl = document.querySelector("#error");
const versionEl = document.querySelector("#version");
const hintEl = document.querySelector("#reorder-hint");
const addButton = document.querySelector("#add-button");
const menuEl = document.querySelector("#menu");

let snapshot = null;
let badges = new Map();
let catalogOpen = true;
let busy = false;
let menuServiceId = null;
let confirmRemove = false;

function showError(error) {
  const message = error == null ? "" : String(error);
  errorEl.hidden = message.length === 0;
  errorEl.textContent = message;
}

function applySnapshot(next) {
  snapshot = next;
  badges = new Map(
    Object.entries(next.badges || {}).map(([id, count]) => [id, Number(count) || 0]),
  );
  versionEl.textContent = `v${next.version}`;
  renderServices();
  if (!editorEl.hidden) return;
  renderCatalog();
}

function presetFor(service) {
  return (snapshot.presets || []).find((preset) => preset.id === service.preset) || null;
}

function hashColor(name) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 32% 36%)`;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function mark(parent, service) {
  const preset = presetFor(service);
  const node = document.createElement("span");
  node.className = "mark";
  node.style.setProperty("--mark", preset ? preset.color : hashColor(service.name));
  if (service.icon && isHttpUrl(service.icon)) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = service.icon;
    node.append(img);
  } else if (service.icon) {
    node.textContent = service.icon;
  } else if (preset) {
    node.textContent = preset.monogram;
  } else {
    node.textContent = service.name.slice(0, 2);
  }
  parent.append(node);
}

function badgeLabel(count) {
  if (!count) return "";
  return count > 99 ? "99+" : String(count);
}

function renderServices() {
  servicesEl.replaceChildren();
  const services = snapshot?.services || [];
  hintEl.hidden = services.length < 2;
  for (const service of services) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "service";
    button.dataset.id = service.id;
    button.draggable = true;
    button.setAttribute("aria-label", service.name);
    if (snapshot.activeId === service.id) {
      button.classList.add("active");
      button.setAttribute("aria-current", "true");
    }
    mark(button, service);
    const name = document.createElement("span");
    name.className = "service-name";
    name.textContent = service.name;
    button.append(name);
    const count = badges.get(service.id) || 0;
    if (count > 0) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = badgeLabel(count);
      button.append(badge);
    }
    button.addEventListener("click", () => focusService(service.id));
    button.addEventListener("dragstart", (event) => {
      button.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", service.id);
    });
    button.addEventListener("dragend", () => button.classList.remove("dragging"));
    button.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });
    button.addEventListener("drop", (event) => onDrop(event, service.id));
    servicesEl.append(button);
  }
  syncStage();
}

function syncStage() {
  const covered = !catalogOpen && Boolean(snapshot?.activeId);
  stageEl.inert = covered;
  addButton.setAttribute("aria-expanded", catalogOpen ? "true" : "false");
}

async function onDrop(event, targetId) {
  event.preventDefault();
  const sourceId = event.dataTransfer.getData("text/plain");
  if (!sourceId || sourceId === targetId) return;
  const ids = snapshot.services.map((service) => service.id);
  const from = ids.indexOf(sourceId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0) return;
  ids.splice(from, 1);
  ids.splice(to, 0, sourceId);
  await run(async () => {
    applySnapshot(await invoke("reorder_services", { ids }));
  });
}

function renderCatalog() {
  catalogEl.hidden = false;
  editorEl.hidden = true;
  catalogEl.replaceChildren();
  const head = document.createElement("div");
  head.className = "catalog-head";
  const title = document.createElement("h1");
  title.textContent = snapshot.services.length ? "Add a service" : "All your web apps, one window.";
  const copy = document.createElement("p");
  copy.textContent = snapshot.services.length
    ? "Each add gets its own saved login. Add WhatsApp twice and the two accounts stay separate."
    : "Pick a preset or add any http(s) URL. Each service keeps its own cookies, storage, and user agent.";
  head.append(title, copy);
  catalogEl.append(head);

  const grid = document.createElement("div");
  grid.className = "preset-grid";
  for (const preset of snapshot.presets) {
    grid.append(presetCard(preset));
  }
  catalogEl.append(grid, customForm(), footerNote());
}

function presetCard(preset) {
  const card = document.createElement("article");
  card.className = "preset";
  const top = document.createElement("div");
  top.className = "preset-top";
  const fake = { name: preset.name, icon: null, preset: preset.id };
  mark(top, fake);
  const heading = document.createElement("h2");
  heading.textContent = preset.name;
  top.append(heading);
  card.append(top);

  let urlInput = null;
  if (preset.needsUrl) {
    const note = document.createElement("p");
    note.textContent = "Uses the server URL you enter. The session stays on this computer.";
    urlInput = document.createElement("input");
    urlInput.type = "url";
    urlInput.placeholder = preset.urlPlaceholder;
    urlInput.spellcheck = false;
    urlInput.setAttribute("aria-label", `${preset.name} server URL`);
    card.append(note, urlInput);
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "add";
  button.textContent = "Add";
  button.addEventListener("click", () => {
    addAndOpen({
      preset: preset.id,
      url: urlInput ? urlInput.value : null,
    });
  });
  card.append(button);
  return card;
}

function customForm() {
  const form = document.createElement("form");
  form.className = "custom";
  const heading = document.createElement("h2");
  heading.textContent = "Custom service";
  form.append(heading);
  const name = field("Name", "text", "Work chat");
  const url = field("URL", "url", "https://example.com");
  const icon = field("Icon", "text", "Emoji, two letters, or an image URL");
  const agent = field("User agent", "text", "Leave empty for the default Chrome UA");
  form.append(name.label, url.label, icon.label, agent.label);
  const actions = document.createElement("div");
  actions.className = "actions";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary";
  submit.textContent = "Add custom service";
  actions.append(submit);
  form.append(actions, userAgentDetails());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    addAndOpen({
      name: name.input.value,
      url: url.input.value,
      icon: icon.input.value,
      userAgent: agent.input.value,
    });
  });
  return form;
}

function field(labelText, type, placeholder) {
  const label = document.createElement("label");
  label.className = "field";
  const span = document.createElement("span");
  span.textContent = labelText;
  const input = document.createElement("input");
  input.type = type;
  input.placeholder = placeholder;
  input.spellcheck = false;
  label.append(span, input);
  return { label, input };
}

function userAgentDetails() {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Default user agent";
  const code = document.createElement("code");
  code.textContent = snapshot.defaultUserAgent;
  details.append(summary, code);
  return details;
}

function footerNote() {
  const note = document.createElement("p");
  note.className = "fine";
  note.textContent = `Config file: ${snapshot.configPath}. Quit Rustbox before editing it by hand. Sessions live under ${snapshot.dataDir}.`;
  return note;
}

function openEditor(service) {
  catalogEl.hidden = true;
  editorEl.hidden = false;
  editorEl.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = `Edit ${service.name}`;
  const name = field("Name", "text", "");
  name.input.value = service.name;
  const url = field("URL", "url", "https://");
  url.input.value = service.url;
  const icon = field("Icon", "text", "Optional");
  icon.input.value = service.icon || "";
  const agent = field("User agent", "text", "Empty uses the default Chrome UA");
  agent.input.value = service.userAgent || "";
  const note = document.createElement("p");
  note.className = "editor-note";
  note.textContent = "Changing the URL or user agent reloads the page. The saved login for this slot stays in the same folder.";
  const actions = document.createElement("div");
  actions.className = "actions";
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "primary";
  save.textContent = "Save";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "ghost";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => closeEditor(true));
  actions.append(save, cancel);
  editorEl.append(heading, name.label, url.label, icon.label, agent.label, note, actions, userAgentDetails());
  editorEl.onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      applySnapshot(
        await invoke("update_service", {
          id: service.id,
          name: name.input.value,
          url: url.input.value,
          icon: icon.input.value,
          userAgent: agent.input.value,
        }),
      );
      await closeEditor(true);
    });
  };
}

async function closeEditor(showService) {
  editorEl.hidden = true;
  editorEl.onsubmit = null;
  catalogOpen = !showService;
  renderCatalog();
  if (showService && snapshot.activeId) {
    await invoke("set_services_visible", { visible: true });
    catalogOpen = false;
  } else if (!showService) {
    await invoke("set_services_visible", { visible: false });
  }
  syncStage();
}

async function addAndOpen(payload) {
  await run(async () => {
    const result = await invoke("add_service", {
      name: emptyToNull(payload.name),
      url: emptyToNull(payload.url),
      icon: emptyToNull(payload.icon),
      userAgent: emptyToNull(payload.userAgent),
      preset: payload.preset || null,
    });
    applySnapshot(result);
    catalogOpen = false;
    await invoke("set_services_visible", { visible: true });
    applySnapshot(await invoke("focus_service", { id: result.createdId }));
    showError("");
  });
}

function emptyToNull(value) {
  const text = value == null ? "" : String(value).trim();
  return text.length ? text : null;
}

async function focusService(id) {
  closeMenu();
  catalogOpen = false;
  editorEl.hidden = true;
  await run(async () => {
    await invoke("set_services_visible", { visible: true });
    applySnapshot(await invoke("focus_service", { id }));
  });
}

async function showCatalog() {
  closeMenu();
  catalogOpen = true;
  editorEl.hidden = true;
  renderCatalog();
  await run(async () => {
    await invoke("set_services_visible", { visible: false });
    syncStage();
  });
}

function openMenu(x, y, id) {
  menuServiceId = id;
  confirmRemove = false;
  menuEl.replaceChildren();
  for (const item of [
    ["Reload", () => act("reload_service", { id })],
    ["Edit", () => beginEdit(id)],
    ["Remove", () => armRemove()],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item[0];
    button.setAttribute("role", "menuitem");
    button.addEventListener("click", item[1]);
    menuEl.append(button);
  }
  menuEl.hidden = false;
  const rect = menuEl.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menuEl.style.left = `${Math.max(8, left)}px`;
  menuEl.style.top = `${Math.max(8, top)}px`;
}

function armRemove() {
  if (!confirmRemove) {
    confirmRemove = true;
    const button = menuEl.querySelector("button:last-child");
    if (button) button.textContent = "Confirm remove";
    return;
  }
  const id = menuServiceId;
  closeMenu();
  run(async () => {
    applySnapshot(await invoke("remove_service", { id }));
    if (!snapshot.activeId) {
      catalogOpen = true;
      renderCatalog();
      await invoke("set_services_visible", { visible: false });
    } else {
      catalogOpen = false;
      await invoke("set_services_visible", { visible: true });
      applySnapshot(await invoke("focus_service", { id: snapshot.activeId }));
    }
  });
}

async function beginEdit(id) {
  const service = snapshot.services.find((item) => item.id === id);
  closeMenu();
  if (!service) return;
  catalogOpen = true;
  await invoke("set_services_visible", { visible: false });
  openEditor(service);
  syncStage();
}

async function act(command, args) {
  const id = menuServiceId;
  closeMenu();
  await run(async () => {
    await invoke(command, args || { id });
  });
}

function closeMenu() {
  menuEl.hidden = true;
  menuServiceId = null;
  confirmRemove = false;
}

async function run(work) {
  if (busy) return;
  busy = true;
  try {
    await work();
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
  }
}

function stageBounds() {
  const rect = stageEl.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

addButton.addEventListener("click", () => {
  if (catalogOpen && editorEl.hidden) {
    if (snapshot?.activeId) {
      catalogOpen = false;
      run(() => invoke("set_services_visible", { visible: true }).then(() => syncStage()));
    }
    return;
  }
  showCatalog();
});

document.querySelector("#sidebar").addEventListener("contextmenu", (event) => {
  const row = event.target.closest(".service");
  if (!row) return;
  event.preventDefault();
  openMenu(event.clientX, event.clientY, row.dataset.id);
});

document.addEventListener("click", (event) => {
  if (!menuEl.hidden && !menuEl.contains(event.target)) closeMenu();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenu();
    return;
  }
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
  if (event.key < "1" || event.key > "9") return;
  const service = snapshot?.services[Number(event.key) - 1];
  if (!service) return;
  event.preventDefault();
  focusService(service.id);
});

document.addEventListener("dragover", (event) => {
  if ([...event.dataTransfer.types].includes("Files")) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  if ([...event.dataTransfer.types].includes("Files")) event.preventDefault();
});

async function boot() {
  await listen("badge-updated", (event) => {
    const { serviceId, count } = event.payload || {};
    if (!serviceId) return;
    badges.set(serviceId, Number(count) || 0);
    renderServices();
  });
  applySnapshot(await invoke("get_state"));
  await invoke("set_content_bounds", stageBounds());
  if (snapshot.activeId) {
    catalogOpen = false;
    applySnapshot(await invoke("focus_service", { id: snapshot.activeId }));
  } else {
    catalogOpen = true;
    renderCatalog();
    await invoke("set_services_visible", { visible: false });
  }
  syncStage();
  const report = () => {
    invoke("set_content_bounds", stageBounds()).catch((error) => showError(error));
  };
  let timer = 0;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(report, 60);
  };
  new ResizeObserver(schedule).observe(stageEl);
  window.addEventListener("resize", schedule);
}

boot().catch((error) => showError(error));
