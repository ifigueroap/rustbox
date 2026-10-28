import { beforeEach, describe, expect, it, vi } from "vitest";

import { invoke } from "../src/ipc";
import { applyShellSnapshot, mountShell, openIncludeServices } from "../src/shell";
import { service, snapshot, workspace } from "./fixtures";
import { shellHtml } from "./html";

const calls: { command: string; args: Record<string, unknown> }[] = [];
let backend: (command: string, args: Record<string, unknown>) => unknown;

const invokeMock = vi.mocked(invoke);

type MenuRecord = { text?: string; enabled?: boolean; action?: () => void };

function menus(): MenuRecord[][] {
  const stored = (globalThis as { __rustboxMenus?: MenuRecord[][] }).__rustboxMenus;
  if (!stored) throw new Error("menu mock was not installed");
  return stored;
}

function loadShell(): void {
  document.documentElement.innerHTML = shellHtml();
  mountShell();
}

function editor(): HTMLDialogElement {
  const node = document.querySelector<HTMLDialogElement>("#workspace-editor");
  if (!node) throw new Error("no workspace dialog");
  return node;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function openRailMenu(workspaceId: string): Promise<MenuRecord[]> {
  const button = document.querySelector<HTMLButtonElement>(
    `#workspace-list [data-workspace-id="${workspaceId}"]`,
  );
  if (!button) throw new Error("no rail button");
  button.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 24 }),
  );
  await flush();
  const menu = menus().at(-1);
  if (!menu) throw new Error("menu was not created");
  return menu;
}

function menuItem(menu: MenuRecord[], text: string): MenuRecord {
  const found = menu.find((entry) => entry.text === text);
  if (!found?.action) throw new Error(`missing menu item ${text}`);
  return found;
}

beforeEach(() => {
  calls.length = 0;
  menus().length = 0;
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
  loadShell();
});

describe("workspace menu dialogs", () => {
  it("opens the editor after Rename and suspends then restores the active service", async () => {
    const main = workspace("Main", { order: 0, color: "#c4554a" });
    const spotmind = workspace("Spotmind", { order: 1, color: "#3d7ea6" });
    const slack = service("Slack", [main.id, spotmind.id], { preset: "slack" });
    const view = (activeId: string | null) =>
      snapshot({
        workspaces: [main, spotmind],
        services: [slack],
        activeWorkspaceId: main.id,
        activeId,
      });

    const seen: { id: unknown; editorOpen: boolean }[] = [];
    backend = (command, args) => {
      if (command !== "set_active_service") throw new Error(`unexpected ${command}`);
      seen.push({ id: args.id, editorOpen: editor().open });
      return view((args.id as string | null) ?? null);
    };

    applyShellSnapshot(view(slack.id));
    const menu = await openRailMenu(main.id);
    menuItem(menu, "Rename…").action?.();
    await flush();

    expect(seen[0]).toEqual({ id: null, editorOpen: false });
    expect(editor().open).toBe(true);
    expect(document.querySelector("#workspace-editor-title")?.textContent).toBe("Rename Main");

    document.querySelector<HTMLButtonElement>("#workspace-cancel")?.click();
    await flush();

    expect(editor().open).toBe(false);
    expect(seen.at(-1)).toEqual({ id: slack.id, editorOpen: false });
  });

  it("does the same for Edit icon and color", async () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const slack = service("Slack", [main.id], { preset: "slack" });
    const view = (activeId: string | null) =>
      snapshot({
        workspaces: [main, spotmind],
        services: [slack],
        activeWorkspaceId: main.id,
        activeId,
      });
    backend = (command, args) => {
      if (command !== "set_active_service") throw new Error(`unexpected ${command}`);
      return view((args.id as string | null) ?? null);
    };

    applyShellSnapshot(view(slack.id));
    const menu = await openRailMenu(main.id);
    menuItem(menu, "Edit icon and color…").action?.();
    await flush();

    expect(editor().open).toBe(true);
    expect(document.querySelector("#workspace-editor-title")?.textContent).toBe("Edit Main");
    expect(calls[0]).toMatchObject({ command: "set_active_service", args: { id: null } });

    document.querySelector<HTMLButtonElement>("#workspace-cancel")?.click();
    await flush();
    expect(editor().open).toBe(false);
    expect(calls.at(-1)).toMatchObject({ command: "set_active_service", args: { id: slack.id } });
  });

  it("opens New workspace from the rail while a service is showing, then restores it", async () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const slack = service("Slack", [main.id], { preset: "slack" });
    const view = (activeId: string | null) =>
      snapshot({
        workspaces: [main, spotmind],
        services: [slack],
        activeWorkspaceId: main.id,
        activeId,
      });
    backend = (command, args) => {
      if (command !== "set_active_service") throw new Error(`unexpected ${command}`);
      return view((args.id as string | null) ?? null);
    };

    applyShellSnapshot(view(slack.id));
    document.querySelector<HTMLButtonElement>("#workspace-add")?.click();
    expect(editor().open).toBe(false);
    await flush();
    expect(editor().open).toBe(true);
    expect(document.querySelector("#workspace-editor-title")?.textContent).toBe("New workspace");
    expect(calls[0]).toMatchObject({ command: "set_active_service", args: { id: null } });

    document.querySelector<HTMLButtonElement>("#workspace-cancel")?.click();
    await flush();
    expect(calls.at(-1)).toMatchObject({ command: "set_active_service", args: { id: slack.id } });
  });

  it("does not suspend when the desk is already showing", async () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    applyShellSnapshot(snapshot({ workspaces: [main, spotmind], services: [], activeId: null }));
    const menu = await openRailMenu(main.id);
    menuItem(menu, "Rename…").action?.();
    await flush();
    expect(editor().open).toBe(true);
    expect(calls.some((call) => call.command === "set_active_service")).toBe(false);
  });

  it("still opens the editor if the menu item was already closed", async () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const slack = service("Slack", [main.id], { preset: "slack" });
    backend = (command, args) => {
      if (command !== "set_active_service") throw new Error(`unexpected ${command}`);
      return snapshot({
        workspaces: [main, spotmind],
        services: [slack],
        activeWorkspaceId: main.id,
        activeId: (args.id as string | null) ?? null,
      });
    };
    applyShellSnapshot(
      snapshot({
        workspaces: [main, spotmind],
        services: [slack],
        activeWorkspaceId: main.id,
        activeId: slack.id,
      }),
    );
    const menu = await openRailMenu(spotmind.id);
    const rename = menuItem(menu, "Rename…");
    await (rename as { close?: () => Promise<void> }).close?.();
    rename.action?.();
    await flush();
    expect(editor().open).toBe(true);
    expect(document.querySelector("#workspace-editor-title")?.textContent).toBe("Rename Spotmind");
  });
});

describe("include services and delete", () => {
  it("suspends for Include services and restores after cancel", async () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const slack = service("Slack", [main.id], { preset: "slack" });
    const discord = service("Discord", [spotmind.id], { preset: "discord" });
    const view = (activeId: string | null) =>
      snapshot({
        workspaces: [main, spotmind],
        services: [slack, discord],
        activeWorkspaceId: main.id,
        activeId,
      });
    backend = (command, args) => {
      if (command !== "set_active_service") throw new Error(`unexpected ${command}`);
      return view((args.id as string | null) ?? null);
    };

    applyShellSnapshot(view(slack.id));
    openIncludeServices(main.id);
    expect(document.querySelector<HTMLDialogElement>("#include-services")?.open).toBe(false);
    await flush();
    expect(document.querySelector<HTMLDialogElement>("#include-services")?.open).toBe(true);
    expect(calls[0]).toMatchObject({ command: "set_active_service", args: { id: null } });

    document.querySelector<HTMLButtonElement>("#include-cancel")?.click();
    await flush();
    expect(document.querySelector<HTMLDialogElement>("#include-services")?.open).toBe(false);
    expect(calls.at(-1)).toMatchObject({ command: "set_active_service", args: { id: slack.id } });
  });

  it("hides the service webview before the delete confirmation and restores on cancel", async () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const slack = service("Slack", [main.id], { preset: "slack" });
    const order: string[] = [];
    vi.spyOn(window, "confirm").mockImplementation(() => {
      order.push("confirm");
      return false;
    });
    const view = (activeId: string | null) =>
      snapshot({
        workspaces: [main, spotmind],
        services: [slack],
        activeWorkspaceId: main.id,
        activeId,
      });
    backend = (command, args) => {
      if (command !== "set_active_service") throw new Error(`unexpected ${command}`);
      order.push(`active:${String(args.id)}`);
      return view((args.id as string | null) ?? null);
    };

    applyShellSnapshot(view(slack.id));
    const menu = await openRailMenu(spotmind.id);
    menuItem(menu, "Delete workspace…").action?.();
    await flush();

    expect(order).toEqual(["active:null", "confirm", `active:${slack.id}`]);
    expect(calls.some((call) => call.command === "remove_workspace")).toBe(false);
  });

  it("deletes after confirm and restores a service that is still in the workspace", async () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const slack = service("Slack", [main.id], { preset: "slack" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    backend = (command, args) => {
      if (command === "set_active_service") {
        return snapshot({
          workspaces: calls.some((call) => call.command === "remove_workspace") ? [main] : [main, spotmind],
          services: [slack],
          activeWorkspaceId: main.id,
          activeId: (args.id as string | null) ?? null,
        });
      }
      if (command === "remove_workspace") {
        return snapshot({
          workspaces: [main],
          services: [slack],
          activeWorkspaceId: main.id,
          activeId: null,
        });
      }
      throw new Error(`unexpected ${command}`);
    };

    applyShellSnapshot(
      snapshot({
        workspaces: [main, spotmind],
        services: [slack],
        activeWorkspaceId: main.id,
        activeId: slack.id,
      }),
    );
    const menu = await openRailMenu(spotmind.id);
    menuItem(menu, "Delete workspace…").action?.();
    await flush();

    expect(calls.map((call) => call.command)).toEqual([
      "set_active_service",
      "remove_workspace",
      "set_active_service",
    ]);
    expect(calls[0]?.args.id).toBeNull();
    expect(calls[2]?.args.id).toBe(slack.id);
  });
});

describe("workspace switcher popup", () => {
  function popup(): HTMLElement {
    const node = document.querySelector<HTMLElement>("#workspace-switcher-popup");
    if (!node) throw new Error("no popup");
    return node;
  }

  it("suspends the active service while the chip list is open and restores on Escape", async () => {
    const main = workspace("Main", { order: 0, color: "#c4554a" });
    const spotmind = workspace("Spotmind", { order: 1, color: "#3d7ea6" });
    const slack = service("Slack", [main.id], { preset: "slack" });
    const view = (activeId: string | null) =>
      snapshot({
        workspaces: [main, spotmind],
        services: [slack],
        activeWorkspaceId: main.id,
        activeId,
        workspaceRailHidden: true,
      });
    backend = (command, args) => {
      if (command !== "set_active_service") throw new Error(`unexpected ${command}`);
      return view((args.id as string | null) ?? null);
    };

    applyShellSnapshot(view(slack.id));
    document.querySelector<HTMLButtonElement>("#workspace-switcher-button")?.click();
    expect(popup().hidden).toBe(true);
    await flush();

    expect(popup().hidden).toBe(false);
    expect(popup().style.width).not.toBe("");
    expect(calls[0]).toMatchObject({ command: "set_active_service", args: { id: null } });
    const active = popup().querySelector<HTMLElement>(".ws-popup-row.active");
    expect(active?.style.getPropertyValue("--ws-color")).toBe("#c4554a");
    expect(popup().querySelector(".ws-popup-name")?.textContent).toBe("Main");
    expect(popup().querySelector(".ws-popup-add")?.textContent).toBe("New workspace");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();
    expect(popup().hidden).toBe(true);
    expect(calls.at(-1)).toMatchObject({ command: "set_active_service", args: { id: slack.id } });
  });

  it("keeps the popup inside a narrow window", async () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    applyShellSnapshot(
      snapshot({
        workspaces: [main, spotmind],
        services: [],
        workspaceRailHidden: true,
      }),
    );
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 170 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 640 });
    document.querySelector<HTMLButtonElement>("#workspace-switcher-button")?.click();

    const width = Number.parseFloat(popup().style.width);
    const left = Number.parseFloat(popup().style.left);
    expect(popup().hidden).toBe(false);
    expect(width).toBeGreaterThan(96);
    expect(left + width).toBeLessThanOrEqual(170);
    expect(calls.some((call) => call.command === "set_active_service")).toBe(false);
  });

  it("opens New workspace from the chip without restoring the service over the dialog", async () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const slack = service("Slack", [main.id], { preset: "slack" });
    const view = (activeId: string | null) =>
      snapshot({
        workspaces: [main, spotmind],
        services: [slack],
        activeWorkspaceId: main.id,
        activeId,
        workspaceRailHidden: true,
      });
    backend = (command, args) => {
      if (command !== "set_active_service") throw new Error(`unexpected ${command}`);
      return view((args.id as string | null) ?? null);
    };

    applyShellSnapshot(view(slack.id));
    document.querySelector<HTMLButtonElement>("#workspace-switcher-button")?.click();
    await flush();
    const add = popup().querySelector<HTMLButtonElement>(".ws-popup-add");
    add?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    add?.click();
    expect(editor().open).toBe(true);
    await flush();

    expect(editor().open).toBe(true);
    expect(popup().hidden).toBe(true);
    const restores = calls.filter((call) => call.command === "set_active_service" && call.args.id === slack.id);
    expect(restores).toHaveLength(0);

    document.querySelector<HTMLButtonElement>("#workspace-cancel")?.click();
    await flush();
    expect(calls.at(-1)).toMatchObject({ command: "set_active_service", args: { id: slack.id } });
  });

  it("restores on an outside click", async () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const slack = service("Slack", [main.id], { preset: "slack" });
    const view = (activeId: string | null) =>
      snapshot({
        workspaces: [main, spotmind],
        services: [slack],
        activeWorkspaceId: main.id,
        activeId,
        workspaceRailHidden: true,
      });
    backend = (command, args) => {
      if (command !== "set_active_service") throw new Error(`unexpected ${command}`);
      return view((args.id as string | null) ?? null);
    };
    applyShellSnapshot(view(slack.id));
    document.querySelector<HTMLButtonElement>("#workspace-switcher-button")?.click();
    await flush();
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await flush();
    expect(popup().hidden).toBe(true);
    expect(calls.at(-1)).toMatchObject({ command: "set_active_service", args: { id: slack.id } });
  });
});

describe("add button tooltips", () => {
  it("distinguishes the rail's new workspace from the sidebar's add service", () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    applyShellSnapshot(snapshot({ workspaces: [main, spotmind], services: [] }));
    expect(document.querySelector("#workspace-add")?.getAttribute("title")).toBe("New workspace");
    expect(document.querySelector("#manage-button")?.getAttribute("title")).toBe("Add a service");
    expect(document.querySelector("#manage-button")?.classList.contains("is-add")).toBe(true);
  });
});
