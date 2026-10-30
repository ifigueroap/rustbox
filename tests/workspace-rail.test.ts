import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyShellSnapshot, currentWorkspaceState, mountShell, render } from "../src/shell";
import { service, snapshot, workspace } from "./fixtures";
import { shellHtml } from "./html";

function loadShell(): void {
  document.documentElement.innerHTML = shellHtml();
  mountShell();
}

function rail(): HTMLElement {
  const node = document.querySelector<HTMLElement>("#workspace-rail");
  if (!node) throw new Error("no rail");
  return node;
}

function switcher(): HTMLElement {
  const node = document.querySelector<HTMLElement>("#workspace-switcher");
  if (!node) throw new Error("no switcher");
  return node;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  loadShell();
});

describe("renderWorkspaceRail", () => {
  it("keeps the static rail children when the rail hides and shows again", () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const slack = service("Slack", [main.id], { preset: "slack" });

    applyShellSnapshot(snapshot({ workspaces: [main], services: [slack] }));
    expect(currentWorkspaceState().railVisible).toBe(false);
    // The bug: hiding the rail used to delete these two elements.
    expect(document.querySelector("#workspace-list")).not.toBeNull();
    expect(document.querySelector("#workspace-add")).not.toBeNull();

    applyShellSnapshot(
      snapshot({ workspaces: [main, spotmind], services: [slack], activeWorkspaceId: spotmind.id }),
    );
    expect(currentWorkspaceState().railVisible).toBe(true);
    expect(rail().hidden).toBe(false);
    expect(rail().querySelectorAll(".ws").length).toBe(2);

    applyShellSnapshot(snapshot({ workspaces: [main], services: [slack] }));
    expect(currentWorkspaceState().railVisible).toBe(false);
    expect(document.querySelector("#workspace-list")).not.toBeNull();
    expect(document.querySelector("#workspace-add")).not.toBeNull();

    applyShellSnapshot(
      snapshot({ workspaces: [main, spotmind], services: [slack], activeWorkspaceId: main.id }),
    );
    expect(rail().querySelectorAll(".ws").length).toBe(2);
  });

  it("never shows 'Missing #workspace-list' and still paints the sidebar", () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const slack = service("Slack", [main.id], { preset: "slack" });
    const discord = service("Discord", [spotmind.id], { preset: "discord" });

    applyShellSnapshot(snapshot({ workspaces: [main], services: [slack, discord] }));
    applyShellSnapshot(
      snapshot({ workspaces: [main, spotmind], services: [slack, discord], activeWorkspaceId: spotmind.id }),
    );

    const banner = document.querySelector<HTMLElement>("#app-error");
    expect(banner?.hidden).toBe(true);
    expect(document.body.textContent).not.toContain("Missing #workspace-list");
    // A workspace with a service keeps that service's icon in the sidebar.
    expect(document.querySelectorAll("#service-list .svc").length).toBe(1);
    expect(document.querySelector("#service-list .svc .avatar img")).not.toBeNull();
  });

  it("repaints every other stage when one stage throws", () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const slack = service("Slack", [main.id], { preset: "slack" });

    applyShellSnapshot(
      snapshot({ workspaces: [main, spotmind], services: [slack], activeWorkspaceId: main.id }),
    );
    expect(document.querySelectorAll("#service-list .svc").length).toBe(1);

    // Simulate the original failure: a stage can no longer find its anchor.
    const list = document.querySelector("#workspace-list");
    list?.remove();
    render();

    // The rail reports the failure, but the sidebar and desk still render.
    expect(document.querySelector<HTMLElement>("#app-error")?.hidden).toBe(false);
    expect(document.querySelector("#app-error")?.textContent).toContain("#workspace-list");
    expect(document.querySelectorAll("#service-list .svc").length).toBe(1);
    expect(document.querySelectorAll("#dash-grid .card").length).toBe(1);
  });
});

describe("workspace switcher", () => {
  it("replaces the rail with a switcher when the rail is collapsed", () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const slack = service("Slack", [main.id], { preset: "slack" });

    applyShellSnapshot(snapshot({ workspaces: [main, spotmind], services: [slack] }));
    expect(switcher().hidden).toBe(true);
    expect(currentWorkspaceState().railVisible).toBe(true);

    applyShellSnapshot(
      snapshot({ workspaces: [main, spotmind], services: [slack], workspaceRailHidden: true }),
    );
    expect(currentWorkspaceState().railVisible).toBe(false);
    expect(currentWorkspaceState().switcherVisible).toBe(true);
    expect(switcher().hidden).toBe(false);
    expect(rail().hidden).toBe(true);
    expect(document.querySelector("#workspace-switcher-name")?.textContent).toBe("Main");

    const button = document.querySelector<HTMLButtonElement>("#workspace-switcher-button");
    button?.click();
    const popup = document.querySelector<HTMLElement>("#workspace-switcher-popup");
    expect(popup?.hidden).toBe(false);
    expect(popup?.querySelectorAll(".ws-popup-row").length).toBe(3); // two + New workspace
    expect(button?.getAttribute("aria-expanded")).toBe("true");
  });

  it("hides the switcher again with a single workspace", () => {
    const main = workspace("Main", { order: 0 });
    applyShellSnapshot(
      snapshot({ workspaces: [main], services: [], workspaceRailHidden: true }),
    );
    expect(switcher().hidden).toBe(true);
  });

  it("offers the rail toggle in the sidebar footer once there are two workspaces", () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const toggle = document.querySelector<HTMLButtonElement>("#rail-toggle-button");

    applyShellSnapshot(snapshot({ workspaces: [main], services: [] }));
    expect(toggle?.hidden).toBe(true);

    applyShellSnapshot(snapshot({ workspaces: [main, spotmind], services: [] }));
    expect(toggle?.hidden).toBe(false);
    expect(toggle?.title).toBe("Hide workspace rail");
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");

    applyShellSnapshot(
      snapshot({ workspaces: [main, spotmind], services: [], workspaceRailHidden: true }),
    );
    expect(toggle?.title).toBe("Show workspace rail");
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("empty workspace", () => {
  it("explains an empty workspace in the sidebar and the desk", () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const slack = service("Slack", [main.id], { preset: "slack" });

    applyShellSnapshot(
      snapshot({ workspaces: [main, spotmind], services: [slack], activeWorkspaceId: spotmind.id }),
    );

    const sidebarEmpty = document.querySelector<HTMLElement>("#service-empty");
    expect(sidebarEmpty?.hidden).toBe(false);
    expect(sidebarEmpty?.textContent).toContain("No services in this workspace yet");
    expect(document.querySelector("#service-list")?.hasAttribute("hidden")).toBe(true);

    const deskEmpty = document.querySelector<HTMLElement>("#dash-empty");
    expect(deskEmpty?.hidden).toBe(false);
    expect(deskEmpty?.textContent).toContain("No services in Spotmind yet");
    expect(document.querySelector("#dash-empty-include")?.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector("#dash-empty-all")?.hasAttribute("hidden")).toBe(false);
  });
});

describe("render", () => {
  it("is safe to call repeatedly", () => {
    const main = workspace("Main", { order: 0 });
    applyShellSnapshot(snapshot({ workspaces: [main], services: [] }));
    for (let i = 0; i < 4; i += 1) render();
    expect(document.querySelector("#workspace-list")).not.toBeNull();
    expect(document.querySelector<HTMLElement>("#app-error")?.hidden).toBe(true);
  });

  it("keeps every static anchor across rail, empty, and switching states", () => {
    // The 0.5.0 bug was a must() lookup on an element a parent had wiped. This
    // is the audit: every anchor the shell dereferences must survive a full
    // cycle of the states that rebuild lists.
    const anchors = [
      "#shell",
      "#workspace-rail",
      "#workspace-list",
      "#workspace-add",
      "#workspace-switcher",
      "#workspace-switcher-button",
      "#workspace-switcher-popup",
      "#service-list",
      "#service-empty",
      "#empty-add-service",
      "#empty-include-services",
      "#brand-button",
      "#collapse-button",
      "#rail-toggle-button",
      "#manage-button",
      "#dnd-button",
      "#dashboard",
      "#dash-grid",
      "#dash-empty",
      "#dash-empty-text",
      "#dash-empty-add",
      "#dash-empty-include",
      "#dash-empty-all",
      "#dash-scope",
      "#dash-scope-row",
      "#dash-title",
      "#dash-lede",
      "#dash-eyebrow",
      "#app-version",
      "#stage-status",
      "#app-error",
      "#app-error-text",
      "#app-error-dismiss",
      "#rail-toggle",
      "#close-tray",
      "#theme-select",
      "#language-select",
      "#manager",
      "#editor",
      "#workspace-editor",
      "#include-services",
      "#preset-list",
      "#custom-fields",
      "#editor-fields",
      "#include-options",
      "#include-title",
      "#include-hint",
      "#include-error",
      "#include-save",
      "#workspace-include-options",
      "#workspace-include-field",
      "#workspace-save",
      "#workspace-error",
      "#config-path",
      "#sessions-path",
      "#ua-hint",
    ];
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const slack = service("Slack", [main.id], { preset: "slack" });
    const discord = service("Discord", [spotmind.id], { preset: "discord" });

    const states = [
      snapshot({ workspaces: [main], services: [slack] }),
      snapshot({ workspaces: [main, spotmind], services: [slack, discord] }),
      snapshot({
        workspaces: [main, spotmind],
        services: [slack, discord],
        workspaceRailHidden: true,
      }),
      snapshot({ workspaces: [main, spotmind], services: [], activeWorkspaceId: spotmind.id }),
      snapshot({ workspaces: [main], services: [] }),
    ];
    for (const state of states) {
      applyShellSnapshot(state);
      render();
      for (const anchor of anchors) {
        expect(
          document.querySelector(anchor),
          `${anchor} after ${state.workspaces.length} workspace(s)`,
        ).not.toBeNull();
      }
    }
  });
});

describe("workspace shortcuts", () => {
  it("keeps Ctrl+Alt+1..9 working while the rail is collapsed", async () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    applyShellSnapshot(
      snapshot({ workspaces: [main, spotmind], services: [], workspaceRailHidden: true }),
    );
    const { invoke } = await import("../src/ipc");
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockResolvedValueOnce(
      snapshot({ workspaces: [main, spotmind], services: [], activeWorkspaceId: spotmind.id }),
    );

    // The shell switches workspaces itself, so the rail being collapsed must
    // not take the shortcut away from it.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "2", ctrlKey: true, altKey: true, bubbles: true }),
    );
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("set_active_workspace", {
      id: spotmind.id,
    });
  });

  it("ignores the workspace shortcut when the rail is showing", async () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    applyShellSnapshot(snapshot({ workspaces: [main, spotmind], services: [] }));
    const { invoke } = await import("../src/ipc");
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockResolvedValueOnce(
      snapshot({ workspaces: [main, spotmind], services: [], activeWorkspaceId: spotmind.id }),
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "2", ctrlKey: true, altKey: true, bubbles: true }),
    );
    // Same behaviour with or without the rail: the shortcut is global.
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("set_active_workspace", {
      id: spotmind.id,
    });
  });
});
