import { beforeEach, describe, expect, it, vi } from "vitest";

import { invoke } from "../src/ipc";
import {
  applyShellSnapshot,
  currentWorkspaceState,
  mountShell,
  openWorkspaceEditor,
  render,
  saveWorkspaceEditor,
} from "../src/shell";
import { service, snapshot, workspace } from "./fixtures";
import { shellHtml } from "./html";

const calls: { command: string; args: Record<string, unknown> }[] = [];
let backend: (command: string, args: Record<string, unknown>) => unknown;

const invokeMock = vi.mocked(invoke);

function loadShell(): void {
  document.documentElement.innerHTML = shellHtml();
  mountShell();
}

function dialog(): HTMLDialogElement {
  const node = document.querySelector<HTMLDialogElement>("#workspace-editor");
  if (!node) throw new Error("no workspace dialog");
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
  loadShell();
});

describe("saveWorkspaceEditor", () => {
  it("closes the dialog even when the re-render throws", async () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const slack = service("Slack", [main.id], { preset: "slack" });

    applyShellSnapshot(snapshot({ workspaces: [main], services: [slack] }));
    backend = (command) => {
      if (command !== "add_workspace") throw new Error(`unexpected ${command}`);
      // The workspace is created; the snapshot that comes back then fails to
      // paint because a static anchor is gone. Save must still dismiss.
      document.querySelector("#workspace-list")?.remove();
      return snapshot({
        workspaces: [main, spotmind],
        services: [{ ...slack, workspaces: [main.id, spotmind.id] }],
        activeWorkspaceId: spotmind.id,
      });
    };

    openWorkspaceEditor(null, "create");
    expect(dialog().open).toBe(true);
    document.querySelector<HTMLInputElement>("#workspace-name")!.value = "Spotmind";

    await saveWorkspaceEditor();

    expect(calls.some((call) => call.command === "add_workspace")).toBe(true);
    expect(dialog().open).toBe(false);
    // The failure is reported in the banner, not as raw text on the page.
    expect(document.querySelector<HTMLElement>("#app-error")?.hidden).toBe(false);
    // The sidebar still painted, so its icons survive the failed rail render.
    expect(document.querySelectorAll("#service-list .svc").length).toBe(1);
  });

  it("creates only one workspace when Save is clicked twice", async () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    applyShellSnapshot(snapshot({ workspaces: [main], services: [] }));

    let resolve = () => {};
    const gate = new Promise<void>((done) => {
      resolve = done;
    });
    backend = (command) => {
      if (command !== "add_workspace") throw new Error(`unexpected ${command}`);
      return gate.then(() =>
        snapshot({ workspaces: [main, spotmind], services: [], activeWorkspaceId: spotmind.id }),
      );
    };

    openWorkspaceEditor(null, "create");
    document.querySelector<HTMLInputElement>("#workspace-name")!.value = "Spotmind";
    const save = document.querySelector<HTMLButtonElement>("#workspace-save")!;

    const first = saveWorkspaceEditor();
    // The second click happens while the first save is still in flight.
    const second = saveWorkspaceEditor();
    expect(save.disabled).toBe(true);

    resolve();
    await Promise.all([first, second]);

    const creates = calls.filter((call) => call.command === "add_workspace");
    expect(creates.length).toBe(1);
    expect(currentWorkspaceState().workspaces.length).toBe(2);
    expect(dialog().open).toBe(false);
  });

  it("keeps the dialog open with an inline error when the backend rejects", async () => {
    const main = workspace("Main", { order: 0 });
    applyShellSnapshot(snapshot({ workspaces: [main], services: [] }));

    backend = () => {
      throw new Error("at most 24 workspaces");
    };

    openWorkspaceEditor(null, "create");
    document.querySelector<HTMLInputElement>("#workspace-name")!.value = "Spotmind";
    await saveWorkspaceEditor();

    expect(dialog().open).toBe(true);
    const error = document.querySelector<HTMLElement>("#workspace-error");
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toContain("at most 24 workspaces");
    // The name is still there for a retry, and Save is usable again.
    expect(document.querySelector<HTMLInputElement>("#workspace-name")?.value).toBe("Spotmind");
    expect(document.querySelector<HTMLButtonElement>("#workspace-save")?.disabled).toBe(false);
  });

  it("passes the ticked existing services along with the new workspace", async () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const slack = service("Slack", [main.id], { preset: "slack" });
    const discord = service("Discord", [main.id], { preset: "discord" });
    applyShellSnapshot(snapshot({ workspaces: [main], services: [slack, discord] }));

    backend = (command) => {
      if (command !== "add_workspace") throw new Error(`unexpected ${command}`);
      return snapshot({
        workspaces: [main, spotmind],
        services: [
          slack,
          discord,
        ],
        activeWorkspaceId: spotmind.id,
      });
    };

    openWorkspaceEditor(null, "create");
    document.querySelector<HTMLInputElement>("#workspace-name")!.value = "Spotmind";
    const include = document.querySelector<HTMLInputElement>(
      `#workspace-include-options input[value="${discord.id}"]`,
    );
    expect(include).not.toBeNull();
    include!.checked = true;

    await saveWorkspaceEditor();

    const create = calls.find((call) => call.command === "add_workspace");
    const payload = create?.args.workspace as { includeServices?: string[] } | undefined;
    expect(payload?.includeServices).toEqual([discord.id]);
  });
});

describe("include services", () => {  it("does not offer the step when there are no services at all", () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    applyShellSnapshot(
      snapshot({ workspaces: [main, spotmind], services: [], activeWorkspaceId: spotmind.id }),
    );
    openWorkspaceEditor(null, "create");
    const field = document.querySelector<HTMLElement>("#workspace-include-field");
    // Nothing exists to include, so the dialog must not show an empty picker.
    expect(field?.hidden).toBe(true);
    expect(document.querySelectorAll("#workspace-include-options input").length).toBe(0);
  });

  it("offers only services that are not in every workspace yet", () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const pinned = service("Grok", [], { preset: "grok", allWorkspaces: true });
    const slack = service("Slack", [main.id], { preset: "slack" });
    applyShellSnapshot(
      snapshot({ workspaces: [main, spotmind], services: [pinned, slack], activeWorkspaceId: main.id }),
    );
    openWorkspaceEditor(null, "create");
    const field = document.querySelector<HTMLElement>("#workspace-include-field");
    expect(field?.hidden).toBe(false);
    // An all-workspaces service already shows in the new workspace.
    expect(document.querySelectorAll("#workspace-include-options input").length).toBe(1);
    expect(
      document.querySelector<HTMLInputElement>("#workspace-include-options input")?.value,
    ).toBe(slack.id);
  });
});
