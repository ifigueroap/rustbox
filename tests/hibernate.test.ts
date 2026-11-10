import { beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { CheckMenuItem } from "@tauri-apps/api/menu";
import { invoke } from "../src/ipc";
import { en } from "../src/i18n/en";
import { es } from "../src/i18n/es";
import { applyShellSnapshot, mountShell, openSettings, renderShell } from "../src/shell";
import { service, snapshot, workspace, type TestSnapshot } from "./fixtures";
import { shellHtml } from "./html";

type MenuEntry = { text?: string; action?: () => void };
const menus = () => (globalThis as { __rustboxMenus?: MenuEntry[][] }).__rustboxMenus!;
const calls: { command: string; args: Record<string, unknown> }[] = [];
let state: TestSnapshot;
let backend: (command: string, args: Record<string, unknown>) => unknown;

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function change(id: string, value: string | boolean): void {
  const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(id)!;
  if (typeof value === "boolean") (input as HTMLInputElement).checked = value;
  else input.value = value;
  input.dispatchEvent(new Event("change"));
}

beforeEach(() => {
  calls.length = 0;
  menus().length = 0;
  document.documentElement.innerHTML = shellHtml();
  mountShell();
  state = snapshot();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockImplementation(async () => () => {});
  backend = (command, args) => {
    if (command === "list_presets") return [];
    if (command === "get_state") return state;
    if (command === "set_hibernation_settings") {
      state = { ...state, hibernateAfterMinutes: Number(args.afterMinutes),
        hibernateInactiveWorkspaces: Boolean(args.inactiveWorkspaces) };
      return state;
    }
    if (command === "set_service_never_hibernate") {
      state = { ...state, services: state.services.map((item) => item.id === args.id
        ? { ...item, neverHibernate: Boolean(args.enabled) } : item) };
      return state;
    }
    if (command === "set_active_service") {
      state = { ...state, activeId: args.id as string | null,
        services: state.services.map((item) => item.id === args.id
          ? { ...item, hibernated: false } : item) };
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

describe("idle service hibernation", () => {
  it("has matching, nonempty English and Spanish hibernation messages", () => {
    const keys = Object.keys(en).filter((key) => key.startsWith("hibernate.")).sort();
    expect(keys).toHaveLength(10);
    expect(Object.keys(es).filter((key) => key.startsWith("hibernate.")).sort()).toEqual(keys);
    for (const key of keys) {
      expect(en[key as keyof typeof en]).toBeTruthy();
      expect(es[key as keyof typeof es]).toBeTruthy();
    }
  });
  it("defaults to Off and reveals the workspace opt-in only when enabled", async () => {
    applyShellSnapshot(state);
    openSettings();
    const select = document.querySelector<HTMLSelectElement>("#hibernate-after")!;
    const row = document.querySelector<HTMLElement>("#hibernate-workspaces-row")!;
    expect(select.value).toBe("0");
    expect([...select.options].map((item) => item.value)).toEqual(["0", "5", "15", "30", "60"]);
    expect(row.hidden).toBe(true);
    expect(document.querySelector<HTMLInputElement>("#hibernate-workspaces")!.checked).toBe(false);
    expect(select.closest(".settings-section")?.querySelector("h3")?.textContent).toBe("Window");

    change("#hibernate-after", "15");
    await flush();
    expect(row.hidden).toBe(false);
    change("#hibernate-workspaces", true);
    await flush();
    expect(calls.filter((call) => call.command === "set_hibernation_settings").map((call) => call.args)).toEqual([
      { afterMinutes: 15, inactiveWorkspaces: false },
      { afterMinutes: 15, inactiveWorkspaces: true },
    ]);
    change("#hibernate-after", "0");
    await flush();
    expect(row.hidden).toBe(true);
    expect(state.hibernateInactiveWorkspaces).toBe(true);
  });

  it("restores the saved controls and displays an inline error on a failed save", async () => {
    state = snapshot({ hibernateAfterMinutes: 30, hibernateInactiveWorkspaces: true });
    applyShellSnapshot(state);
    backend = () => { throw new Error("disk full"); };
    change("#hibernate-after", "5");
    await flush();
    expect(document.querySelector<HTMLSelectElement>("#hibernate-after")!.value).toBe("30");
    expect(document.querySelector<HTMLInputElement>("#hibernate-workspaces")!.checked).toBe(true);
    expect(document.querySelector("#app-error")?.textContent).toContain("disk full");
  });

  it("retains the last unread count with a moon and dimming hooks in sidebar and Home", () => {
    state.services[0] = { ...state.services[0], hibernated: true, rawUnread: 7, unread: 7 };
    applyShellSnapshot(state);
    const sidebar = document.querySelector<HTMLElement>("#service-list .svc")!;
    const card = document.querySelector<HTMLElement>("#dash-grid .card")!;
    expect(sidebar.classList.contains("hibernated")).toBe(true);
    expect(card.classList.contains("hibernated")).toBe(true);
    expect(sidebar.querySelector(".badge")?.textContent).toBe("7");
    expect(card.querySelector(".unread-pill")?.textContent).toContain("7");
    expect(sidebar.title).toContain("Hibernated");
    expect(card.querySelector(".hibernation-mark")?.getAttribute("aria-label")).toContain("open to wake");
    // Do not disturb retains its existing badge rules, even for stale counts.
    applyShellSnapshot({ ...state, doNotDisturb: true,
      services: state.services.map((item) => ({ ...item, unread: 0 })) });
    expect(document.querySelector("#service-list .badge")).toBeNull();
    expect(document.querySelector("#dash-grid .unread-pill")?.textContent).toContain("7");
  });

  it("activates sleeping services through the normal activation command", async () => {
    state.services[0].hibernated = true;
    applyShellSnapshot(state);
    document.querySelector<HTMLButtonElement>("#service-list .svc")!.click();
    await flush();
    expect(calls.find((call) => call.command === "set_active_service")?.args).toEqual({ id: state.services[0].id });
    expect(document.querySelector("#service-list .svc")?.classList.contains("hibernated")).toBe(false);
    expect(document.querySelector("#service-list .hibernation-mark")).toBeNull();
    expect(document.querySelector("#service-list .svc")?.getAttribute("aria-selected")).toBe("true");
  });

  it.each([false, true])("toggles Never hibernate from %s in the existing service menu", async (enabled) => {
    state.services[0].neverHibernate = enabled;
    applyShellSnapshot(state);
    const createCheck = vi.spyOn(CheckMenuItem, "new");
    document.querySelector("#service-list .svc")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await flush();
    expect(createCheck).toHaveBeenCalledWith(expect.objectContaining({ text: "Never hibernate", checked: enabled }));
    const entries = menus().at(-1)!;
    expect(entries.map((entry) => entry.text)).toEqual(expect.arrayContaining([
      "Never hibernate", "Reset zoom", "Spellcheck", "Clear cache and reload", "Log out (clear session)",
    ]));
    const item = entries.find((entry) => entry.text === "Never hibernate")!;
    item.action!();
    await flush();
    expect(calls.find((call) => call.command === "set_service_never_hibernate")?.args).toEqual({ id: state.services[0].id, enabled: !enabled });
    expect(state.services[0].neverHibernate).toBe(!enabled);
    createCheck.mockRestore();
  });

  it("keeps shared/pinned sleeping services as single cards when viewing all workspaces", () => {
    const work = workspace("Work");
    const personal = workspace("Personal");
    const shared = service("Shared", [work.id, personal.id], { hibernated: true, unread: 3, rawUnread: 3 });
    const pinned = service("Pinned", [], { allWorkspaces: true, hibernated: true });
    const elsewhere = service("Elsewhere", [personal.id]);
    state = snapshot({ workspaces: [work, personal], activeWorkspaceId: work.id, services: [shared, pinned, elsewhere] });
    applyShellSnapshot(state);
    document.querySelector<HTMLButtonElement>("#dash-scope")!.click();
    expect(document.querySelectorAll(`#dash-grid [data-service-id="${shared.id}"]`)).toHaveLength(1);
    expect(document.querySelectorAll("#dash-grid .card.hibernated")).toHaveLength(2);
    expect(document.querySelectorAll("#dash-grid .card")).toHaveLength(3);
  });

  it("ignores queued unread events for sleeping services and resumes them after wake", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    vi.mocked(listen).mockImplementation(async (name, handler) => {
      handlers.set(name, handler as (event: { payload: unknown }) => void);
      return () => {};
    });
    state.services[0] = { ...state.services[0], hibernated: true, rawUnread: 4, unread: 4 };
    await renderShell();
    const sleeping = state.services[0];
    handlers.get("unread-count")!({ payload: { serviceId: sleeping.id, count: 99, rawCount: 99 } });
    expect(document.querySelector("#service-list .badge")?.textContent).toBe("4");
    expect(document.querySelector("#dash-grid .unread-pill")?.textContent).toContain("4");
    applyShellSnapshot({ ...state, services: [{ ...sleeping, hibernated: false }] });
    handlers.get("unread-count")!({ payload: { serviceId: sleeping.id, count: 8, rawCount: 8 } });
    expect(document.querySelector("#service-list .badge")?.textContent).toBe("8");
    expect(document.querySelector("#dash-grid .unread-pill")?.textContent).toContain("8");
  });

  it("translates the settings, status, and service menu into Spanish", async () => {
    state = snapshot({ language: "es", hibernateAfterMinutes: 5, hibernateInactiveWorkspaces: true });
    state.services[0].hibernated = true;
    applyShellSnapshot(state);
    expect(document.querySelector('label[for="hibernate-after"]')?.textContent).toBe("Hibernar servicios en segundo plano después de");
    expect(document.querySelector('#hibernate-after option[value="0"]')?.textContent).toBe("Desactivado");
    expect(document.querySelector('#hibernate-after option[value="5"]')?.textContent).toBe("5 minutos");
    expect(document.querySelector("#service-list .svc")?.getAttribute("title")).toContain("En hibernación");
    document.querySelector("#service-list .svc")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await flush();
    expect(menus().at(-1)!.some((entry) => entry.text === "Nunca hibernar")).toBe(true);
  });
});
