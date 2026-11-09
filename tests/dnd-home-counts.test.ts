import { beforeEach, describe, expect, it, vi } from "vitest";

import { listen } from "@tauri-apps/api/event";
import { invoke } from "../src/ipc";
import { applyShellSnapshot, mountShell, renderShell } from "../src/shell";
import { service, snapshot, workspace } from "./fixtures";
import { shellHtml } from "./html";

const listenMock = vi.mocked(listen);
const invokeMock = vi.mocked(invoke);

function loadShell(): void {
  document.documentElement.innerHTML = shellHtml();
  mountShell();
}

function pill(serviceId: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(
    `#dash-grid [data-unread-for="${serviceId}"]`,
  );
  if (!node) throw new Error("no unread pill for " + serviceId);
  return node;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  listenMock.mockReset();
  listenMock.mockImplementation(async () => () => {});
  invokeMock.mockReset();
  loadShell();
});

describe("Home unread counts during Do Not Disturb", () => {
  it("keeps showing the unread count on the desk card while global DnD is on", () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id], {
      preset: "slack",
      notificationsEnabled: true,
      rawUnread: 3,
      unread: 0,
      workspaceSilenced: false,
    });

    applyShellSnapshot(snapshot({ workspaces: [main], services: [slack], doNotDisturb: true }));

    expect(pill(slack.id).textContent).not.toBe("No unread");
    expect(pill(slack.id).classList.contains("has-unread")).toBe(true);
    expect(pill(slack.id).classList.contains("dnd-quiet")).toBe(true);
    // The attention badge stays hidden under DnD.
    expect(document.querySelector("#service-list .badge")).toBeNull();
  });

  it("still hides the Home count when the service's own Badges switch is off", () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id], {
      preset: "slack",
      notificationsEnabled: false,
      rawUnread: 3,
      unread: 0,
    });

    applyShellSnapshot(snapshot({ workspaces: [main], services: [slack], doNotDisturb: false }));

    expect(pill(slack.id).textContent).toBe("No unread");
    expect(pill(slack.id).classList.contains("has-unread")).toBe(false);
  });

  it("shows the count undimmed while awake", () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id], {
      preset: "slack",
      notificationsEnabled: true,
      rawUnread: 2,
      unread: 2,
    });

    applyShellSnapshot(snapshot({ workspaces: [main], services: [slack], doNotDisturb: false }));

    expect(pill(slack.id).classList.contains("has-unread")).toBe(true);
    expect(pill(slack.id).classList.contains("dnd-quiet")).toBe(false);
    expect(document.querySelector("#service-list .badge")).not.toBeNull();
  });

  it("refreshes the desk pill from a live raw-count change even though the badge count stays 0 under DnD", async () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id], {
      preset: "slack",
      notificationsEnabled: true,
      rawUnread: 0,
      unread: 0,
    });

    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    listenMock.mockImplementation(async (name: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(name, handler);
      return () => {};
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_presets") return [];
      if (command === "get_state") {
        return snapshot({ workspaces: [main], services: [slack], doNotDisturb: true });
      }
      throw new Error(`unexpected ${command}`);
    });

    await renderShell();
    expect(pill(slack.id).textContent).toBe("No unread");

    handlers.get("unread-count")?.({ payload: { serviceId: slack.id, count: 0, rawCount: 4 } });

    expect(pill(slack.id).textContent).not.toBe("No unread");
    expect(pill(slack.id).classList.contains("has-unread")).toBe(true);
    expect(document.querySelector("#service-list .badge")).toBeNull();
  });
});
