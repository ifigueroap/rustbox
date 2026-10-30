import { beforeEach, describe, expect, it, vi } from "vitest";

import { listen } from "@tauri-apps/api/event";
import { invoke } from "../src/ipc";
import { applyShellSnapshot, closeSettings, mountShell, openSettings, renderShell } from "../src/shell";
import { service, snapshot, workspace } from "./fixtures";
import { shellHtml } from "./html";

const calls: { command: string; args: Record<string, unknown> }[] = [];
let backend: (command: string, args: Record<string, unknown>) => unknown;

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

function loadShell(): void {
  document.documentElement.innerHTML = shellHtml();
  mountShell();
}

function settingsDialog(): HTMLDialogElement {
  const node = document.querySelector<HTMLDialogElement>("#settings");
  if (!node) throw new Error("no settings dialog");
  return node;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
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

describe("workspace header", () => {
  it("keeps the title and the two workspace actions, and nothing else", () => {
    const main = workspace("Main", { order: 0, serviceCount: 7 });
    applyShellSnapshot(
      snapshot({
        workspaces: [main],
        services: Array.from({ length: 7 }, (_, index) => service(`S${index}`, [main.id])),
        activeWorkspaceId: main.id,
        appVersion: "0.8.0",
      }),
    );

    const head = document.querySelector(".dash-head");
    expect(head?.querySelector("#dash-eyebrow")?.textContent).toBe("workspace");
    expect(head?.querySelector("#dash-title")?.textContent).toBe("Main");
    expect(head?.querySelector("#dash-lede")?.textContent).toContain("7 services in this workspace");
    expect(head?.querySelector("#dash-workspace-add")?.textContent).toBe("New workspace");
    expect(head?.querySelector("#dash-add")?.textContent).toBe("Add service");
    for (const id of ["#theme-select", "#language-select", "#close-tray", "#auto-update", "#check-updates", "#update-checked", "#rail-toggle", "#app-version"]) {
      expect(head?.querySelector(id)).toBeNull();
    }
  });
});

describe("settings dialog", () => {
  it("opens from the gear, suspends the service, and restores it on close", async () => {
    const main = workspace("Main");
    const slack = service("Slack", [main.id]);
    applyShellSnapshot(
      snapshot({
        workspaces: [main],
        services: [slack],
        activeId: slack.id,
        appVersion: "0.8.0",
        theme: "auto",
      }),
    );

    const gear = document.querySelector<HTMLButtonElement>("#settings-button");
    expect(gear?.getAttribute("aria-label")).toBe("Settings");
    expect(gear?.title).toBe("Settings");

    backend = (command, args) => {
      if (command !== "set_active_service") throw new Error(`unexpected ${command}`);
      return snapshot({
        workspaces: [main],
        services: [slack],
        activeId: (args.id as string | null) ?? null,
        appVersion: "0.8.0",
        theme: "auto",
      });
    };

    gear?.click();
    await flush();
    expect(settingsDialog().open).toBe(true);
    expect(calls.some((call) => call.command === "set_active_service" && call.args.id === null)).toBe(true);

    document.querySelector<HTMLButtonElement>("#settings-close")?.click();
    await flush();
    expect(settingsDialog().open).toBe(false);
    expect(calls.some((call) => call.command === "set_active_service" && call.args.id === slack.id)).toBe(
      true,
    );
  });

  it("dismisses on Escape and keeps the same config commands", async () => {
    const main = workspace("Main", { order: 0 });
    const other = workspace("Other", { order: 1 });
    applyShellSnapshot(
      snapshot({
        workspaces: [main, other],
        services: [],
        appVersion: "0.8.0",
        theme: "light",
        closeToTray: true,
        trayAvailable: true,
        update: {
          state: "upToDate",
          current: "0.8.0",
          latest: null,
          notes: null,
          url: null,
          canInstall: true,
          autoCheck: true,
          lastCheckedAt: new Date().toISOString(),
        },
      }),
    );
    openSettings();
    expect(settingsDialog().open).toBe(true);
    expect(document.querySelector("#settings-title")?.textContent).toBe("Settings");
    expect(document.querySelector('[data-value="light"]')?.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector("#update-checked")?.textContent).toMatch(
      /^Version 0\.8\.0 · Up to date · checked /,
    );
    expect(document.querySelector("#close-tray-hint")?.textContent).toBe(
      "Closing the window keeps Rustbox running in the tray.",
    );
    expect(document.querySelector("#app-version")?.textContent).toBe("0.8.0");
    expect((document.querySelector("#rail-toggle") as HTMLInputElement).disabled).toBe(false);
    expect((document.querySelector("#close-tray") as HTMLInputElement).checked).toBe(true);

    backend = (command, args) => {
      if (command === "set_theme") {
        return snapshot({
          workspaces: [main, other],
          services: [],
          theme: args.theme,
          appVersion: "0.8.0",
        });
      }
      if (command === "set_language") {
        return snapshot({
          workspaces: [main, other],
          services: [],
          language: args.language,
          appVersion: "0.8.0",
          theme: "dark",
        });
      }
      if (command === "set_close_to_tray") {
        return snapshot({
          workspaces: [main, other],
          services: [],
          closeToTray: args.enabled,
          appVersion: "0.8.0",
        });
      }
      if (command === "set_workspace_rail_hidden") {
        return snapshot({
          workspaces: [main, other],
          services: [],
          workspaceRailHidden: args.hidden,
          appVersion: "0.8.0",
        });
      }
      if (command === "set_update_auto_check") {
        return snapshot({
          workspaces: [main, other],
          services: [],
          appVersion: "0.8.0",
          update: {
            state: "upToDate",
            current: "0.8.0",
            latest: null,
            notes: null,
            url: null,
            canInstall: true,
            autoCheck: args.enabled,
            lastCheckedAt: new Date().toISOString(),
          },
        });
      }
      if (command === "open_external") return null;
      throw new Error(`unexpected ${command}`);
    };

    document.querySelector<HTMLButtonElement>('[data-value="dark"]')?.click();
    const language = document.querySelector<HTMLSelectElement>("#language-select");
    language!.value = "es";
    language?.dispatchEvent(new Event("change"));
    const closeTray = document.querySelector<HTMLInputElement>("#close-tray");
    closeTray!.checked = false;
    closeTray?.dispatchEvent(new Event("change"));
    const rail = document.querySelector<HTMLInputElement>("#rail-toggle");
    rail!.checked = false;
    rail?.dispatchEvent(new Event("change"));
    const auto = document.querySelector<HTMLInputElement>("#auto-update");
    auto!.checked = false;
    auto?.dispatchEvent(new Event("change"));
    document.querySelector<HTMLButtonElement>("#settings-releases")?.click();
    await flush();

    expect(calls.find((call) => call.command === "set_theme")?.args).toEqual({ theme: "dark" });
    expect(calls.find((call) => call.command === "set_language")?.args.language).toBe("es");
    expect(calls.find((call) => call.command === "set_close_to_tray")?.args).toEqual({ enabled: false });
    expect(calls.find((call) => call.command === "set_workspace_rail_hidden")?.args).toEqual({
      hidden: true,
    });
    expect(calls.find((call) => call.command === "set_update_auto_check")?.args).toEqual({
      enabled: false,
    });
    expect(calls.find((call) => call.command === "open_external")?.args).toEqual({
      url: "https://github.com/ifigueroap/rustbox/releases",
    });

    settingsDialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(settingsDialog().open).toBe(false);
    closeSettings();
    expect(settingsDialog().open).toBe(false);
  });

  it("disables tray and rail switches when they cannot apply", () => {
    const main = workspace("Main");
    applyShellSnapshot(
      snapshot({
        workspaces: [main],
        services: [],
        trayAvailable: false,
        closeToTray: false,
        appVersion: "0.8.0",
      }),
    );
    openSettings();
    expect((document.querySelector("#close-tray") as HTMLInputElement).disabled).toBe(true);
    expect(document.querySelector("#close-tray-hint")?.textContent).toBe(
      "The tray icon is not available, so closing the window quits Rustbox.",
    );
    expect((document.querySelector("#rail-toggle") as HTMLInputElement).disabled).toBe(true);
    expect(document.querySelector("#rail-toggle-hint")?.textContent).toContain("second workspace");
  });

  it("translates the dialog into Spanish", () => {
    const main = workspace("Main");
    applyShellSnapshot(
      snapshot({
        language: "es",
        osLocale: "en",
        workspaces: [main],
        services: [],
        appVersion: "0.8.0",
        update: {
          state: "upToDate",
          current: "0.8.0",
          latest: null,
          notes: null,
          url: null,
          canInstall: true,
          autoCheck: true,
          lastCheckedAt: new Date().toISOString(),
        },
      }),
    );
    expect(document.querySelector("#settings-button")?.getAttribute("aria-label")).toBe("Configuración");
    expect(document.querySelector("#settings-title")?.textContent).toBe("Configuración");
    expect(document.querySelector("#settings .settings-section h3")?.textContent).toBe("Apariencia");
    expect(document.body.textContent).toContain("Mostrar la barra de espacios");
    expect(document.querySelector("#close-tray-hint")?.textContent).toBe(
      "Al cerrar la ventana, Rustbox sigue en ejecución en la bandeja.",
    );
    expect(document.querySelector("#settings-releases")?.textContent).toBe("Abrir la página de versiones");
    expect(document.querySelector("#update-checked")?.textContent).toMatch(
      /^Versión 0\.8\.0 · Al día · revisado a las /,
    );
  });

  it("opens from Ctrl+, and from the tray menu", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    listenMock.mockImplementation(async (event: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(event, handler);
      return () => {};
    });
    const main = workspace("Main");
    const slack = service("Slack", [main.id]);
    backend = (command, args) => {
      if (command === "list_presets") return [];
      if (command === "get_state") {
        return snapshot({
          workspaces: [main],
          services: [slack],
          activeId: slack.id,
          appVersion: "0.8.0",
        });
      }
      if (command === "set_active_service") {
        return snapshot({
          workspaces: [main],
          services: [slack],
          activeId: (args.id as string | null) ?? null,
          appVersion: "0.8.0",
        });
      }
      throw new Error(`unexpected ${command}`);
    };

    await renderShell();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await flush();
    expect(settingsDialog().open).toBe(true);
    closeSettings();
    await flush();
    expect(settingsDialog().open).toBe(false);

    handlers.get("open-settings")?.({ payload: null });
    await flush();
    expect(settingsDialog().open).toBe(true);
  });
});
