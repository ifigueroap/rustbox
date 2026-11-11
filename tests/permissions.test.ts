import { beforeEach, describe, expect, it, vi } from "vitest";

import { invoke } from "../src/ipc";
import {
  applyShellSnapshot,
  dismissPermissionRequest,
  enqueuePermissionRequest,
  mountShell,
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
  const node = document.querySelector<HTMLDialogElement>("#permission-dialog");
  if (!node) throw new Error("no media permission dialog");
  return node;
}

function allowButton(): HTMLButtonElement {
  const node = document.querySelector<HTMLButtonElement>("#permission-allow");
  if (!node) throw new Error("no allow button");
  return node;
}

function denyButton(): HTMLButtonElement {
  const node = document.querySelector<HTMLButtonElement>("#permission-deny");
  if (!node) throw new Error("no deny button");
  return node;
}

function rememberCheckbox(): HTMLInputElement {
  const node = document.querySelector<HTMLInputElement>("#permission-remember");
  if (!node) throw new Error("no remember checkbox");
  return node;
}

function message(): string {
  return document.querySelector("#permission-message")?.textContent ?? "";
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const main = workspace("Main", { order: 0 });
const slack = service("Slack", [main.id], { preset: "slack" });

beforeEach(() => {
  calls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  backend = (command, args) => {
    if (command === "set_active_service") {
      return snapshot({
        workspaces: [main],
        services: [slack],
        activeWorkspaceId: main.id,
        activeId: (args.id as string | null) ?? null,
      });
    }
    throw new Error(`unexpected backend call: ${command}`);
  };
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    const payload = (args ?? {}) as Record<string, unknown>;
    calls.push({ command, args: payload });
    return backend(command, payload);
  });
  loadShell();
  applyShellSnapshot(snapshot({ workspaces: [main], services: [slack], activeWorkspaceId: main.id, activeId: null }));
});

describe("media permission dialog", () => {
  it("shows the combined wording and answers Allow with the remember flag", async () => {
    backend = (command, args) => {
      if (command === "answer_permission") {
        return snapshot({ workspaces: [main], services: [slack], activeWorkspaceId: main.id, activeId: null });
      }
      throw new Error(`unexpected backend call: ${command}`);
    };
    enqueuePermissionRequest({
      requestId: "req-1",
      serviceId: slack.id,
      serviceName: slack.name,
      kind: "media",
      audio: true,
      video: true,
    });
    await flush();
    expect(dialog().open).toBe(true);
    expect(message()).toBe("Slack wants to use your microphone and camera.");

    rememberCheckbox().checked = true;
    allowButton().click();
    await flush();

    expect(dialog().open).toBe(false);
    const answer = calls.find((call) => call.command === "answer_permission");
    expect(answer?.args).toEqual({ requestId: "req-1", allow: true, remember: true });
  });

  it("answers Deny without remembering by default", async () => {
    backend = (command, args) => {
      if (command === "answer_permission") {
        return snapshot({ workspaces: [main], services: [slack], activeWorkspaceId: main.id, activeId: null });
      }
      throw new Error(`unexpected backend call: ${command}`);
    };
    enqueuePermissionRequest({
      requestId: "req-1",
      serviceId: slack.id,
      serviceName: slack.name,
      kind: "media",
      audio: true,
      video: false,
    });
    await flush();
    expect(message()).toBe("Slack wants to use your microphone.");

    denyButton().click();
    await flush();
    const answer = calls.find((call) => call.command === "answer_permission");
    expect(answer?.args).toEqual({ requestId: "req-1", allow: false, remember: false });
  });

  it("queues a second request and shows it once the first is answered", async () => {
    backend = (command, args) => {
      if (command === "answer_permission") {
        return snapshot({ workspaces: [main], services: [slack], activeWorkspaceId: main.id, activeId: null });
      }
      throw new Error(`unexpected backend call: ${command}`);
    };
    enqueuePermissionRequest({
      requestId: "req-1",
      serviceId: slack.id,
      serviceName: slack.name,
      kind: "media",
      audio: false,
      video: true,
    });
    enqueuePermissionRequest({
      requestId: "req-2",
      serviceId: "another-service",
      serviceName: slack.name,
      kind: "media",
      audio: true,
      video: false,
    });
    await flush();
    expect(message()).toBe("Slack wants to use your camera.");

    allowButton().click();
    await flush();
    expect(dialog().open).toBe(true);
    expect(message()).toBe("Slack wants to use your microphone.");

    allowButton().click();
    await flush();
    expect(dialog().open).toBe(false);
    expect(calls.filter((call) => call.command === "answer_permission").map((call) => call.args.requestId)).toEqual([
      "req-1",
      "req-2",
    ]);
  });

  it("dismisses without a second backend call when the native side resolves it first", async () => {
    enqueuePermissionRequest({
      requestId: "req-1",
      serviceId: slack.id,
      serviceName: slack.name,
      kind: "media",
      audio: true,
      video: false,
    });
    await flush();
    expect(dialog().open).toBe(true);

    dismissPermissionRequest("req-1");
    await flush();
    expect(dialog().open).toBe(false);
    expect(calls.some((call) => call.command === "answer_permission")).toBe(false);
  });
  it("hides the active child webview before prompting and restores it after Escape denies", async () => {
    applyShellSnapshot(snapshot({ workspaces: [main], services: [slack], activeWorkspaceId: main.id, activeId: slack.id }));
    backend = (command, args) => {
      if (command === "set_active_service" || command === "answer_permission") {
        return snapshot({ workspaces: [main], services: [slack], activeWorkspaceId: main.id, activeId: command === "set_active_service" ? args.id as string | null : null });
      }
      throw new Error(`unexpected call: ${command}`);
    };
    enqueuePermissionRequest({ requestId: "active", serviceId: slack.id, serviceName: slack.name, kind: "media", audio: true, video: false });
    await flush();
    expect(calls[0]).toEqual({ command: "set_active_service", args: { id: null } });
    expect(dialog().open).toBe(true);
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    await flush();
    expect(calls.map((call) => call.command)).toEqual(["set_active_service", "answer_permission", "set_active_service"]);
    expect(calls[1].args).toEqual({ requestId: "active", allow: false, remember: false });
    expect(calls[2].args).toEqual({ id: slack.id });
    expect(dialog().open).toBe(false);
  });

  it("keeps a failed IPC answer available for retry and prevents duplicate submissions", async () => {
    let reject!: (error: Error) => void;
    backend = () => new Promise((_, fail) => { reject = fail; });
    enqueuePermissionRequest({ requestId: "retry", serviceId: slack.id, serviceName: slack.name, kind: "media", audio: true, video: false });
    await flush();
    allowButton().click();
    denyButton().click();
    expect(calls.filter((call) => call.command === "answer_permission")).toHaveLength(1);
    reject(new Error("IPC unavailable"));
    await flush();
    expect(dialog().open).toBe(true);
    expect(allowButton().disabled).toBe(false);
    backend = () => snapshot({ workspaces: [main], services: [slack], activeWorkspaceId: main.id });
    denyButton().click();
    await flush();
    expect(dialog().open).toBe(false);
    expect(calls.filter((call) => call.command === "answer_permission")).toHaveLength(2);
  });

  it("combines concurrent WebView2 microphone and camera events into one answer", async () => {
    backend = () => snapshot({ workspaces: [main], services: [slack], activeWorkspaceId: main.id });
    enqueuePermissionRequest({ requestId: "mic", serviceId: slack.id, serviceName: slack.name, kind: "media", audio: true, video: false });
    await flush();
    enqueuePermissionRequest({ requestId: "cam", serviceId: slack.id, serviceName: slack.name, kind: "media", audio: false, video: true });
    await flush();
    expect(message()).toBe("Slack wants to use your microphone and camera.");
    rememberCheckbox().checked = true;
    allowButton().click();
    await flush();
    expect(dialog().open).toBe(false);
    expect(calls.filter(call => call.command === "answer_permission").map(call => call.args)).toEqual([
      { requestId: "mic", allow: true, remember: true },
      { requestId: "cam", allow: true, remember: true },
    ]);
  });

  it("dismisses a combined prompt only after both native requests close", async () => {
    enqueuePermissionRequest({ requestId: "mic-close", serviceId: slack.id, serviceName: slack.name, kind: "media", audio: true, video: false });
    enqueuePermissionRequest({ requestId: "cam-close", serviceId: slack.id, serviceName: slack.name, kind: "media", audio: false, video: true });
    await flush();
    dismissPermissionRequest("mic-close");
    await flush();
    expect(dialog().open).toBe(true);
    dismissPermissionRequest("cam-close");
    await flush();
    expect(dialog().open).toBe(false);
    expect(calls.some(call => call.command === "answer_permission")).toBe(false);
  });

  it.each([
    ["screen", "share your screen"],
    ["location", "know your location"],
    ["clipboard", "read your clipboard"],
  ] as const)("prompts for %s and denies on Escape", async (kind, action) => {
    backend = () => snapshot({ workspaces: [main], services: [slack], activeWorkspaceId: main.id });
    enqueuePermissionRequest({
      requestId: kind, serviceId: slack.id, serviceName: slack.name,
      kind, audio: false, video: false,
    });
    await flush();
    expect(message()).toBe(`Slack wants to ${action}.`);
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    await flush();
    expect(calls.find((call) => call.command === "answer_permission")?.args)
      .toEqual({ requestId: kind, allow: false, remember: false });
  });

  it("translates the generic location prompt to Spanish", async () => {
    applyShellSnapshot(snapshot({ language: "es", workspaces: [main], services: [slack], activeWorkspaceId: main.id }));
    enqueuePermissionRequest({
      requestId: "es", serviceId: slack.id, serviceName: slack.name,
      kind: "location", audio: false, video: false,
    });
    await flush();
    expect(message()).toBe("Slack quiere conocer tu ubicación.");
    expect(rememberCheckbox().parentElement?.textContent).toContain("Recordar");
  });

  it("shows compact per-kind controls and routes notifications to the existing switch", async () => {
    applyShellSnapshot(snapshot({ workspaces: [main], services: [{ ...slack, permissions: { screen: "deny", location: "allow" }, notificationsEnabled: false }], activeWorkspaceId: main.id }));
    [...document.querySelectorAll<HTMLButtonElement>(".card-actions button")].find(button => button.textContent === "Edit")!.click();
    await flush();
    const selects = [...document.querySelectorAll<HTMLSelectElement>("#editor-fields [data-permission-kind]")];
    expect(selects.map(select => [select.dataset.permissionKind, select.value])).toEqual([
      ["media", "ask"], ["screen", "deny"], ["location", "allow"], ["clipboard", "ask"],
    ]);
    const notification = document.querySelector<HTMLInputElement>("[data-permission-notifications]")!;
    expect(notification.checked).toBe(false);
    backend = () => snapshot({ workspaces: [main], services: [slack], activeWorkspaceId: main.id });
    notification.click();
    await flush();
    expect(calls.find(call => call.command === "set_service_notifications")?.args).toEqual({ id: slack.id, enabled: true });
    const screen = selects[1];
    screen.value = "allow";
    screen.dispatchEvent(new Event("change"));
    await flush();
    expect(calls.find(call => call.command === "set_service_permission")?.args).toEqual({ id: slack.id, kind: "screen", permission: "allow" });
  });

  it("loads and changes the service editor media policy", async () => {
    applyShellSnapshot(snapshot({ workspaces: [main], services: [{ ...slack, permissions: { media: "deny" } }], activeWorkspaceId: main.id }));
    const edit = [...document.querySelectorAll<HTMLButtonElement>(".card-actions button")].find((button) => button.textContent === "Edit");
    edit!.click();
    await flush();
    const select = [...document.querySelectorAll<HTMLSelectElement>("#editor-fields select")].find((node) => [...node.options].some((option) => option.value === "ask"))!;
    expect(select.value).toBe("deny");
    backend = () => snapshot({ workspaces: [main], services: [{ ...slack, permissions: { media: "allow" } }], activeWorkspaceId: main.id });
    select.value = "allow";
    select.dispatchEvent(new Event("change"));
    await flush();
    expect(calls.find((call) => call.command === "set_service_permission")?.args).toEqual({ id: slack.id, kind: "media", permission: "allow" });
  });

});
