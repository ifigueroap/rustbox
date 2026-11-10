import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "../src/ipc";
import { applyShellSnapshot, renderShell } from "../src/shell";
import { service, snapshot, workspace, type TestSnapshot } from "./fixtures";
import { shellHtml } from "./html";

const listeners = new Map<string, (event: { payload: any }) => void>();
let state: TestSnapshot;
const calls: { command: string; args: Record<string, any> }[] = [];

function input(): HTMLInputElement { return document.querySelector("#find-input")!; }
function key(key: string, options: KeyboardEventInit = {}, target: EventTarget = input()): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}
async function flush(): Promise<void> { await vi.advanceTimersByTimeAsync(0); }
async function open(): Promise<void> { key("f", { ctrlKey: true }, window); await flush(); }
async function type(query: string): Promise<void> {
  input().value = query;
  input().dispatchEvent(new Event("input", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(140);
}
function result(current: number, total: number, extra: Record<string, unknown> = {}): void {
  const requestId = calls.filter((call) => call.command === "find_in_service").at(-1)!.args.requestId;
  listeners.get("find-result")!({ payload: { requestId, current, total, failed: false, ...extra } });
}

beforeEach(async () => {
  vi.useFakeTimers();
  calls.length = 0;
  listeners.clear();
  const main = workspace("Main");
  const slack = service("Slack", [main.id], { zoom: 1.25 });
  state = snapshot({ services: [slack], workspaces: [main], activeId: slack.id, findServiceId: null, language: "en" });
  vi.mocked(listen).mockImplementation(async (name, handler) => {
    listeners.set(name as string, handler as any);
    return () => {};
  });
  vi.mocked(invoke).mockImplementation(async (command, payload) => {
    const args = (payload ?? {}) as Record<string, any>;
    calls.push({ command, args });
    if (command === "list_presets") return [];
    if (command === "get_state") return state;
    if (command === "set_ui_locale" || command === "find_in_service") return;
    if (command === "apply_service_shortcut" && args.key.toLowerCase() === "f") {
      state = { ...state, findServiceId: state.activeId };
      return state;
    }
    if (command === "set_find_open") {
      state = { ...state, findServiceId: args.open ? state.activeId : null };
      return state;
    }
    if (command === "apply_service_shortcut" || command === "reset_service_zoom") return state;
    throw new Error(`unexpected ${command}`);
  });
  document.documentElement.innerHTML = shellHtml();
  await renderShell();
  calls.length = 0;
});

afterEach(() => { vi.useRealTimers(); });

describe("service find strip", () => {
  it("opens with Ctrl/Cmd+F, focuses/selects the input, and ignores chords on the desk", async () => {
    expect(document.querySelector<HTMLElement>("#find-bar")!.hidden).toBe(true);
    expect(key("f", { metaKey: true }, window).defaultPrevented).toBe(true);
    await flush();
    expect(document.querySelector<HTMLElement>("#find-bar")!.hidden).toBe(false);
    expect(document.activeElement).toBe(input());
    await type("Slack");
    input().setSelectionRange(5, 5);
    key("f", { ctrlKey: true });
    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe(5);
    expect(calls.filter((call) => call.command === "apply_service_shortcut")).toHaveLength(1);
    applyShellSnapshot({ ...state, activeId: null, findServiceId: null });
    calls.length = 0;
    key("f", { ctrlKey: true }, window);
    await flush();
    expect(calls).toHaveLength(0);
  });

  it("handles native service shortcuts and page reload events through the same strip", async () => {
    applyShellSnapshot({ ...state, findServiceId: state.activeId });
    listeners.get("open-find")!({ payload: null });
    expect(document.activeElement).toBe(input());
    await type("hello");
    calls.length = 0;
    listeners.get("find-page-loaded")!({ payload: `svc-${state.activeId}` });
    await vi.advanceTimersByTimeAsync(140);
    expect(calls.at(-1)).toMatchObject({ command: "find_in_service", args: { id: state.activeId, query: "hello", direction: 0 } });
  });

  it("debounces typing, shows counts/no matches, and rejects stale results", async () => {
    await open();
    await type("hello");
    expect(calls.at(-1)).toMatchObject({ command: "find_in_service", args: { id: state.activeId, query: "hello", direction: 0 } });
    result(1, 3);
    expect(document.querySelector("#find-status")!.textContent).toBe("1 of 3");
    await type("absent");
    result(1, 99, { requestId: 1 });
    expect(document.querySelector("#find-status")!.textContent).toBe("Searching…");
    result(0, 0);
    expect(document.querySelector("#find-status")!.textContent).toBe("No matches");
    expect(document.querySelector<HTMLButtonElement>("#find-next")!.disabled).toBe(true);
    await type("");
    expect(calls.at(-1)!.args.query).toBe("");
    expect(document.querySelector("#find-status")!.textContent).toBe("");
  });

  it("consumes Enter/Shift+Enter/Escape, sends navigation, and closes without a dialog", async () => {
    await open();
    await type("hello");
    const leaked = vi.fn();
    input().addEventListener("keydown", leaked);
    expect(key("Enter").defaultPrevented).toBe(true);
    await flush();
    expect(calls.at(-1)!.args.direction).toBe(1);
    key("Enter", { shiftKey: true });
    await flush();
    expect(calls.at(-1)!.args.direction).toBe(-1);
    expect(key("Escape").defaultPrevented).toBe(true);
    await flush();
    expect(calls.at(-1)).toEqual({ command: "set_find_open", args: { open: false } });
    expect(document.querySelector<HTMLElement>("#find-bar")!.hidden).toBe(true);
    expect(leaked).not.toHaveBeenCalled();
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("cancels a queued search when switching services or opening a shell cover", async () => {
    await open();
    input().value = "queued";
    input().dispatchEvent(new Event("input"));
    applyShellSnapshot({ ...state, activeId: null, findServiceId: null });
    calls.length = 0;
    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toHaveLength(0);
    expect(input().value).toBe("");
  });

  it("keeps normal Enter activation for the close button", async () => {
    await open();
    const close = document.querySelector<HTMLButtonElement>("#find-close")!;
    close.focus();
    expect(key("Enter", {}, close).defaultPrevented).toBe(false);
    expect(calls.some((call) => call.command === "find_in_service")).toBe(false);
    close.click();
    await flush();
    expect(document.querySelector<HTMLElement>("#find-bar")!.hidden).toBe(true);
  });

  it("uses Spanish find strings and reports search failures inline", async () => {
    state.language = "es";
    await open();
    expect(input().placeholder).toBe("Buscar en la página");
    await type("hola");
    result(0, 0);
    expect(document.querySelector("#find-status")!.textContent).toBe("Sin coincidencias");
    result(0, 0, { failed: true });
    expect(document.querySelector("#find-status")!.textContent).toBe("Búsqueda no disponible");
  });
});

describe("service zoom", () => {
  it("owns Ctrl/Cmd +/-/= and 0 exactly once and leaves Alt chords alone", async () => {
    for (const chord of ["+", "=", "-", "0"]) {
      expect(key(chord, { ctrlKey: true }, window).defaultPrevented).toBe(true);
      await flush();
    }
    expect(key("=", { metaKey: true }, window).defaultPrevented).toBe(true);
    await flush();
    expect(calls.filter((call) => call.command === "apply_service_shortcut").map((call) => call.args.key)).toEqual(["+", "=", "-", "0", "="]);
    expect(key("+", { ctrlKey: true, altKey: true }, window).defaultPrevented).toBe(false);
  });

  it("briefly shows the zoom percentage in the sidebar only for the active service", async () => {
    const toast = document.querySelector<HTMLElement>("#service-zoom")!;
    listeners.get("service-zoom")!({ payload: { id: "other", zoom: 2 } });
    expect(toast.hidden).toBe(true);
    listeners.get("service-zoom")!({ payload: { id: state.activeId, zoom: 1.1 } });
    expect(toast.hidden).toBe(false);
    expect(toast.textContent).toBe("110%");
    await vi.advanceTimersByTimeAsync(1600);
    expect(toast.hidden).toBe(true);
  });

  it("resets a service from its context menu", async () => {
    document.querySelector(".svc")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    await flush();
    const menus = (globalThis as any).__rustboxMenus;
    const reset = menus.at(-1).find((item: any) => item.text === "Reset zoom");
    expect(reset.enabled).toBe(true);
    reset.action();
    await flush();
    expect(calls.at(-1)).toEqual({ command: "reset_service_zoom", args: { id: state.activeId } });
  });
});
