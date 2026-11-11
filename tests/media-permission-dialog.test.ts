import { beforeEach, describe, expect, it, vi } from "vitest";

import { invoke } from "../src/ipc";
import {
  applyShellSnapshot,
  dismissMediaPermissionRequest,
  enqueueMediaPermissionRequest,
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
  const node = document.querySelector<HTMLDialogElement>("#media-permission-dialog");
  if (!node) throw new Error("no media permission dialog");
  return node;
}

function allowButton(): HTMLButtonElement {
  const node = document.querySelector<HTMLButtonElement>("#media-permission-allow");
  if (!node) throw new Error("no allow button");
  return node;
}

function denyButton(): HTMLButtonElement {
  const node = document.querySelector<HTMLButtonElement>("#media-permission-deny");
  if (!node) throw new Error("no deny button");
  return node;
}

function rememberCheckbox(): HTMLInputElement {
  const node = document.querySelector<HTMLInputElement>("#media-permission-remember");
  if (!node) throw new Error("no remember checkbox");
  return node;
}

function message(): string {
  return document.querySelector("#media-permission-message")?.textContent ?? "";
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
      if (command === "answer_media_permission") {
        return snapshot({ workspaces: [main], services: [slack], activeWorkspaceId: main.id, activeId: null });
      }
      throw new Error(`unexpected backend call: ${command}`);
    };
    enqueueMediaPermissionRequest({
      requestId: "req-1",
      serviceId: slack.id,
      serviceName: slack.name,
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
    const answer = calls.find((call) => call.command === "answer_media_permission");
    expect(answer?.args).toEqual({ requestId: "req-1", allow: true, remember: true });
  });

  it("answers Deny without remembering by default", async () => {
    backend = (command, args) => {
      if (command === "answer_media_permission") {
        return snapshot({ workspaces: [main], services: [slack], activeWorkspaceId: main.id, activeId: null });
      }
      throw new Error(`unexpected backend call: ${command}`);
    };
    enqueueMediaPermissionRequest({
      requestId: "req-1",
      serviceId: slack.id,
      serviceName: slack.name,
      audio: true,
      video: false,
    });
    await flush();
    expect(message()).toBe("Slack wants to use your microphone.");

    denyButton().click();
    await flush();
    const answer = calls.find((call) => call.command === "answer_media_permission");
    expect(answer?.args).toEqual({ requestId: "req-1", allow: false, remember: false });
  });

  it("queues a second request and shows it once the first is answered", async () => {
    backend = (command, args) => {
      if (command === "answer_media_permission") {
        return snapshot({ workspaces: [main], services: [slack], activeWorkspaceId: main.id, activeId: null });
      }
      throw new Error(`unexpected backend call: ${command}`);
    };
    enqueueMediaPermissionRequest({
      requestId: "req-1",
      serviceId: slack.id,
      serviceName: slack.name,
      audio: false,
      video: true,
    });
    enqueueMediaPermissionRequest({
      requestId: "req-2",
      serviceId: slack.id,
      serviceName: slack.name,
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
    expect(calls.filter((call) => call.command === "answer_media_permission").map((call) => call.args.requestId)).toEqual([
      "req-1",
      "req-2",
    ]);
  });

  it("dismisses without a second backend call when the native side resolves it first", async () => {
    enqueueMediaPermissionRequest({
      requestId: "req-1",
      serviceId: slack.id,
      serviceName: slack.name,
      audio: true,
      video: false,
    });
    await flush();
    expect(dialog().open).toBe(true);

    dismissMediaPermissionRequest("req-1");
    await flush();
    expect(dialog().open).toBe(false);
    expect(calls.some((call) => call.command === "answer_media_permission")).toBe(false);
  });
  it("hides the active child webview before prompting and restores it after Escape denies", async () => {
    applyShellSnapshot(snapshot({ workspaces: [main], services: [slack], activeWorkspaceId: main.id, activeId: slack.id }));
    backend = (command, args) => {
      if (command === "set_active_service" || command === "answer_media_permission") {
        return snapshot({ workspaces: [main], services: [slack], activeWorkspaceId: main.id, activeId: command === "set_active_service" ? args.id as string | null : null });
      }
      throw new Error(`unexpected call: ${command}`);
    };
    enqueueMediaPermissionRequest({ requestId: "active", serviceId: slack.id, serviceName: slack.name, audio: true, video: false });
    await flush();
    expect(calls[0]).toEqual({ command: "set_active_service", args: { id: null } });
    expect(dialog().open).toBe(true);
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    await flush();
    expect(calls.map((call) => call.command)).toEqual(["set_active_service", "answer_media_permission", "set_active_service"]);
    expect(calls[1].args).toEqual({ requestId: "active", allow: false, remember: false });
    expect(calls[2].args).toEqual({ id: slack.id });
    expect(dialog().open).toBe(false);
  });

  it("keeps a failed IPC answer available for retry and prevents duplicate submissions", async () => {
    let reject!: (error: Error) => void;
    backend = () => new Promise((_, fail) => { reject = fail; });
    enqueueMediaPermissionRequest({ requestId: "retry", serviceId: slack.id, serviceName: slack.name, audio: true, video: false });
    await flush();
    allowButton().click();
    denyButton().click();
    expect(calls.filter((call) => call.command === "answer_media_permission")).toHaveLength(1);
    reject(new Error("IPC unavailable"));
    await flush();
    expect(dialog().open).toBe(true);
    expect(allowButton().disabled).toBe(false);
    backend = () => snapshot({ workspaces: [main], services: [slack], activeWorkspaceId: main.id });
    denyButton().click();
    await flush();
    expect(dialog().open).toBe(false);
    expect(calls.filter((call) => call.command === "answer_media_permission")).toHaveLength(2);
  });

  it("loads and changes the service editor media policy", async () => {
    applyShellSnapshot(snapshot({ workspaces: [main], services: [{ ...slack, mediaPermission: "deny" }], activeWorkspaceId: main.id }));
    const edit = [...document.querySelectorAll<HTMLButtonElement>(".card-actions button")].find((button) => button.textContent === "Edit");
    edit!.click();
    await flush();
    const select = [...document.querySelectorAll<HTMLSelectElement>("#editor-fields select")].find((node) => [...node.options].some((option) => option.value === "ask"))!;
    expect(select.value).toBe("deny");
    backend = () => snapshot({ workspaces: [main], services: [{ ...slack, mediaPermission: "allow" }], activeWorkspaceId: main.id });
    select.value = "allow";
    select.dispatchEvent(new Event("change"));
    await flush();
    expect(calls.find((call) => call.command === "set_service_media_permission")?.args).toEqual({ id: slack.id, permission: "allow" });
  });

});
