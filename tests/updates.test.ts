import { beforeEach, describe, expect, it, vi } from "vitest";

import { listen } from "@tauri-apps/api/event";
import { invoke } from "../src/ipc";
import {
  applyShellSnapshot,
  closeUpdateDialog,
  mountShell,
  openUpdateDialog,
  renderShell,
} from "../src/shell";
import { service, snapshot, workspace, type TestUpdate } from "./fixtures";
import { shellHtml } from "./html";

const calls: { command: string; args: Record<string, unknown> }[] = [];
let backend: (command: string, args: Record<string, unknown>) => unknown;

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

function loadShell(): void {
  document.documentElement.innerHTML = shellHtml();
  mountShell();
}

function available(overrides: Partial<TestUpdate> = {}): TestUpdate {
  return {
    state: "available",
    current: "0.6.0",
    latest: "0.7.0",
    notes: "Tray menu and a signed release.",
    url: "https://github.com/ifigueroap/rustbox/releases/tag/v0.7.0",
    canInstall: true,
    autoCheck: true,
    lastCheckedAt: "2026-10-29T01:00:00Z",
    ...overrides,
  };
}

function dialog(): HTMLDialogElement {
  const node = document.querySelector<HTMLDialogElement>("#update-dialog");
  if (!node) throw new Error("no update dialog");
  return node;
}

beforeEach(() => {
  calls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  backend = (command) => {
    throw new Error(`unexpected backend call: ${command}`);
  };
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    const payload = (args ?? {}) as Record<string, unknown>;
    calls.push({ command, args: payload });
    return await backend(command, payload);
  });
  listenMock.mockReset();
  listenMock.mockImplementation(async () => () => {});
  loadShell();
});

describe("update dialog", () => {
  it("shows the badge and opens a dialog that suspends the service", async () => {
    const main = workspace("Main");
    const slack = service("Slack", [main.id]);
    applyShellSnapshot(
      snapshot({
        workspaces: [main],
        services: [slack],
        activeId: slack.id,
        update: available(),
        appVersion: "0.6.0",
      }),
    );

    const badge = document.querySelector<HTMLButtonElement>("#update-badge");
    expect(badge?.hidden).toBe(false);
    expect(badge?.getAttribute("aria-label")).toBe("Update available: v0.7.0");
    expect(document.querySelector("#app-error")?.hasAttribute("hidden")).toBe(true);

    backend = (command, args) => {
      if (command !== "set_active_service") throw new Error(`unexpected ${command}`);
      return snapshot({
        workspaces: [main],
        services: [slack],
        activeId: (args.id as string | null) ?? null,
        update: available(),
        appVersion: "0.6.0",
      });
    };
    badge?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dialog().open).toBe(true);
    expect(document.querySelector("#update-version")?.textContent).toContain("Version 0.7.0");
    expect(document.querySelector("#update-notes")?.textContent).toContain("signed release");
    expect(calls.some((call) => call.command === "set_active_service" && call.args.id === null)).toBe(
      true,
    );
  });

  it("downloads, then asks before relaunching", async () => {
    applyShellSnapshot(snapshot({ update: available(), appVersion: "0.6.0" }));
    openUpdateDialog();
    expect(document.querySelector<HTMLButtonElement>("#update-install")?.hidden).toBe(false);
    expect(document.querySelector<HTMLButtonElement>("#update-restart")?.hidden).toBe(true);

    backend = (command) => {
      if (command === "install_update") return null;
      if (command === "relaunch_app") return null;
      throw new Error(`unexpected ${command}`);
    };

    document.querySelector<HTMLButtonElement>("#update-install")?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.some((call) => call.command === "install_update")).toBe(true);
    expect(document.querySelector<HTMLButtonElement>("#update-install")?.hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>("#update-restart")?.hidden).toBe(false);
    expect(document.querySelector("#update-restart")?.textContent).toBe("Restart to update");

    document.querySelector<HTMLButtonElement>("#update-restart")?.click();
    await Promise.resolve();
    expect(calls.some((call) => call.command === "relaunch_app")).toBe(true);
  });

  it("offers only the release page when the install cannot replace itself", () => {
    applyShellSnapshot(
      snapshot({ update: available({ canInstall: false }), appVersion: "0.6.0" }),
    );
    openUpdateDialog();
    expect(document.querySelector<HTMLButtonElement>("#update-install")?.hidden).toBe(true);
    expect(document.querySelector<HTMLButtonElement>("#update-restart")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("#update-manual")?.hidden).toBe(false);
    expect(document.querySelector("#update-open")?.textContent).toBe("Open release page");

    backend = (command) => {
      if (command === "open_external") return null;
      throw new Error(`unexpected ${command}`);
    };
    document.querySelector<HTMLButtonElement>("#update-open")?.click();
    expect(calls[0]).toMatchObject({
      command: "open_external",
      args: { url: "https://github.com/ifigueroap/rustbox/releases/tag/v0.7.0" },
    });
  });

  it("skips the version and later leaves it available", async () => {
    const main = workspace("Main");
    const base = snapshot({ workspaces: [main], update: available(), appVersion: "0.6.0" });
    applyShellSnapshot(base);
    openUpdateDialog();

    backend = (command) => {
      if (command !== "skip_update") throw new Error(`unexpected ${command}`);
      return snapshot({
        workspaces: [main],
        update: available({ state: "idle", notes: null, url: null }),
        appVersion: "0.6.0",
      });
    };
    document.querySelector<HTMLButtonElement>("#update-skip")?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls[0]?.args.version).toBe("0.7.0");
    expect(dialog().open).toBe(false);
    expect(document.querySelector<HTMLButtonElement>("#update-badge")?.hidden).toBe(true);

    applyShellSnapshot(base);
    openUpdateDialog();
    document.querySelector<HTMLButtonElement>("#update-later")?.click();
    expect(dialog().open).toBe(false);
    expect(document.querySelector<HTMLButtonElement>("#update-badge")?.hidden).toBe(false);
    expect(calls.filter((call) => call.command === "skip_update")).toHaveLength(1);
  });

  it("keeps a network failure off the error banner", () => {
    applyShellSnapshot(
      snapshot({
        update: available({
          state: "error",
          latest: null,
          notes: null,
          url: null,
          lastCheckedAt: null,
        }),
      }),
    );
    expect(document.querySelector<HTMLButtonElement>("#update-badge")?.hidden).toBe(true);
    expect(document.querySelector("#update-checked")?.textContent).toBe(
      "Version 0.6.0 · Couldn't check for updates.",
    );
    expect(document.querySelector("#app-error")?.hasAttribute("hidden")).toBe(true);
    expect(dialog().open).toBe(false);
  });
});

describe("update settings and tray", () => {
  it("toggles automatic checks and shows when the last check happened", async () => {
    applyShellSnapshot(
      snapshot({
        update: available({ state: "upToDate", latest: null, notes: null, url: null }),
        appVersion: "0.6.0",
      }),
    );
    const toggle = document.querySelector<HTMLInputElement>("#auto-update");
    expect(toggle?.checked).toBe(true);
    expect(document.querySelector("#update-checked")?.textContent).toContain("Version 0.6.0");
    expect(document.querySelector("#update-checked")?.textContent).toContain("Up to date");
    expect(document.querySelector("#update-checked")?.textContent).toContain("checked ");

    backend = (command, args) => {
      if (command !== "set_update_auto_check") throw new Error(`unexpected ${command}`);
      return snapshot({
        update: available({
          state: "upToDate",
          latest: null,
          notes: null,
          url: null,
          autoCheck: Boolean(args.enabled),
        }),
        appVersion: "0.6.0",
      });
    };
    toggle!.checked = false;
    toggle?.dispatchEvent(new Event("change"));
    await Promise.resolve();
    await Promise.resolve();
    expect(calls[0]).toMatchObject({
      command: "set_update_auto_check",
      args: { enabled: false },
    });
    expect(toggle?.checked).toBe(false);
  });

  it("checks now and opens the dialog when a release is waiting", async () => {
    applyShellSnapshot(snapshot({ appVersion: "0.6.0" }));
    backend = (command) => {
      if (command !== "check_for_updates") throw new Error(`unexpected ${command}`);
      return available();
    };
    document.querySelector<HTMLButtonElement>("#check-updates")?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.some((call) => call.command === "check_for_updates")).toBe(true);
    expect(dialog().open).toBe(true);
    expect(document.querySelector<HTMLButtonElement>("#update-badge")?.hidden).toBe(false);
  });

  it("opens the dialog when the tray menu asks", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    listenMock.mockImplementation(async (event: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(event, handler);
      return () => {};
    });
    const main = workspace("Main");
    backend = (command) => {
      if (command === "list_presets") return [];
      if (command === "get_state") {
        return snapshot({
          workspaces: [main],
          services: [],
          update: available(),
          appVersion: "0.6.0",
        });
      }
      throw new Error(`unexpected ${command}`);
    };

    await renderShell();
    handlers.get("open-update-dialog")?.({ payload: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dialog().open).toBe(true);
    closeUpdateDialog();
    expect(dialog().open).toBe(false);
  });
});
