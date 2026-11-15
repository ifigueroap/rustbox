import { beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "../src/ipc";
import { applyShellSnapshot, mountShell } from "../src/shell";
import { service, snapshot, workspace, type TestSnapshot } from "./fixtures";
import { shellHtml } from "./html";

type MenuRecord = { text?: string; action?: () => void };
const menus = () => (globalThis as { __rustboxMenus?: MenuRecord[][] }).__rustboxMenus!;
const calls: { command: string; args: Record<string, unknown> }[] = [];
let state: TestSnapshot;
let backend: (command: string, args: Record<string, unknown>) => unknown;

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function row(): HTMLButtonElement {
  const node = document.querySelector<HTMLButtonElement>("#service-list .svc");
  if (!node) throw new Error("no sidebar row");
  return node;
}

async function contextMenu(): Promise<MenuRecord[]> {
  row().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await flush();
  return menus().at(-1)!;
}

async function openEditor(): Promise<void> {
  const editButtons = [...document.querySelectorAll<HTMLButtonElement>(".card-actions button")];
  const edit = editButtons.find((button) => button.textContent === "Edit");
  if (!edit) throw new Error("missing Edit action; open the desk first");
  edit.click();
  await flush();
}

function disableCheckbox(): HTMLInputElement {
  const span = document.querySelector<HTMLElement>('#editor-fields span[data-i18n="service.disabled"]');
  const input = span?.closest("label")?.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error("no Disabled checkbox in the editor");
  return input;
}

beforeEach(() => {
  calls.length = 0;
  menus().length = 0;
  document.documentElement.innerHTML = shellHtml();
  mountShell();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockImplementation(async () => () => {});
  backend = (command, args) => {
    if (command === "list_presets") return [];
    if (command === "get_state") return state;
    if (command === "set_service_disabled") {
      state = {
        ...state,
        services: state.services.map((item) =>
          item.id === args.id ? { ...item, disabled: Boolean(args.disabled) } : item,
        ),
      };
      return state;
    }
    if (command === "set_active_service") {
      state = { ...state, activeId: args.id as string | null };
      return state;
    }
    throw new Error(`unexpected command ${command}`);
  };
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const payload = (args ?? {}) as Record<string, unknown>;
    calls.push({ command, args: payload });
    return backend(command, payload);
  });
});

describe("disabling a service", () => {
  it("renders a disabled row dimmed but still listed, without marking it active", async () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id], { disabled: true });
    state = snapshot({ workspaces: [main], services: [slack] });
    applyShellSnapshot(state);

    expect(row().classList.contains("disabled")).toBe(true);
    expect(row().title).toContain("Disabled");
    expect(row().querySelector(".disabled-mark")?.getAttribute("aria-label")).toBe("Disabled");
    expect(document.querySelectorAll("#service-list .svc")).toHaveLength(1);
    expect(row().classList.contains("active")).toBe(false);
  });

  it("shows an inline Enable panel instead of a webview when a disabled row is clicked", async () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id], { disabled: true });
    state = snapshot({ workspaces: [main], services: [slack] });
    applyShellSnapshot(state);

    row().click();
    await flush();

    expect(calls.some((call) => call.command === "set_active_service")).toBe(false);
    expect(document.querySelector<HTMLElement>("#disabled-panel")?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("#dashboard")?.hidden).toBe(true);
    expect(document.querySelector("#disabled-panel-body")?.textContent).toContain("Slack");
    // No native dialog/alert/confirm is used for this flow.
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("hides the open webview so the Enable panel is not covered", async () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id], { disabled: true });
    const mail = service("Mail", [main.id]);
    state = snapshot({ workspaces: [main], services: [slack, mail], activeId: mail.id });
    applyShellSnapshot(state);

    row().click();
    await flush();

    expect(calls.find((call) => call.command === "set_active_service")?.args).toEqual({ id: null });
    expect(document.querySelector<HTMLElement>("#disabled-panel")?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("#dashboard")?.hidden).toBe(true);
    expect(document.querySelectorAll("#service-list .svc.active")).toHaveLength(0);
  });

  it("enables from the panel, recreates the webview, and switches to it", async () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id], { disabled: true });
    state = snapshot({ workspaces: [main], services: [slack] });
    applyShellSnapshot(state);

    row().click();
    await flush();
    document.querySelector<HTMLButtonElement>("#disabled-panel-enable")!.click();
    await flush();

    expect(calls.find((call) => call.command === "set_service_disabled")?.args).toEqual({
      id: slack.id,
      disabled: false,
    });
    expect(calls.find((call) => call.command === "set_active_service")?.args).toEqual({ id: slack.id });
    expect(document.querySelector<HTMLElement>("#disabled-panel")?.hidden).toBe(true);
    expect(row().classList.contains("disabled")).toBe(false);
  });

  it("offers a Disabled toggle in the editor for an existing service", async () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id]);
    state = snapshot({ workspaces: [main], services: [slack] });
    applyShellSnapshot(state);

    await openEditor();
    const checkbox = disableCheckbox();
    expect(checkbox.checked).toBe(false);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    await flush();

    expect(calls.find((call) => call.command === "set_service_disabled")?.args).toEqual({
      id: slack.id,
      disabled: true,
    });
  });

  it("toggles Disable/Enable from the sidebar context menu", async () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id]);
    state = snapshot({ workspaces: [main], services: [slack] });
    applyShellSnapshot(state);

    let entries = await contextMenu();
    const disable = entries.find((entry) => entry.text === "Disable");
    expect(disable).toBeDefined();
    disable!.action!();
    await flush();
    expect(calls.find((call) => call.command === "set_service_disabled")?.args).toEqual({
      id: slack.id,
      disabled: true,
    });

    entries = await contextMenu();
    expect(entries.some((entry) => entry.text === "Enable")).toBe(true);
    expect(entries.some((entry) => entry.text === "Disable")).toBe(false);
  });

  it("excludes a disabled service from Home's unread total", () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id], {
      disabled: true,
      notificationsEnabled: true,
      rawUnread: 5,
      unread: 0,
    });
    state = snapshot({ workspaces: [main], services: [slack] });
    applyShellSnapshot(state);

    const pill = document.querySelector<HTMLElement>(`#dash-grid [data-unread-for="${slack.id}"]`);
    expect(pill?.textContent).toBe("No unread");
    expect(pill?.classList.contains("has-unread")).toBe(false);
  });

  it("stays a valid drag target while disabled", () => {
    const main = workspace("Main", { order: 0 });
    const a = service("A", [main.id], { disabled: true });
    const b = service("B", [main.id]);
    state = snapshot({ workspaces: [main], services: [a, b] });
    applyShellSnapshot(state);

    const rows = [...document.querySelectorAll<HTMLButtonElement>("#service-list .svc")];
    rows.forEach((node, index) => {
      node.getBoundingClientRect = () => ({ top: index * 50, bottom: index * 50 + 40, height: 40 }) as DOMRect;
      node.setPointerCapture = vi.fn();
      node.releasePointerCapture = vi.fn();
    });
    const [first, second] = rows;
    expect(first.classList.contains("disabled")).toBe(true);

    const fire = (type: string, y: number): void => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { pointerId: 1, button: 0, clientX: 10, clientY: y });
      second.dispatchEvent(event);
    };
    fire("pointerdown", 55);
    fire("pointermove", 20);
    expect(first.classList.contains("drop-target-before")).toBe(true);
    fire("pointerup", 20);
  });
});
