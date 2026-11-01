import { beforeEach, describe, expect, it, vi } from "vitest";

import { listen } from "@tauri-apps/api/event";
import { invoke } from "../src/ipc";
import { mountShell, renderShell } from "../src/shell";
import { service, snapshot, workspace } from "./fixtures";
import { shellHtml } from "./html";
import type { TestService, TestSnapshot } from "./fixtures";

const calls: { command: string; args: Record<string, unknown> }[] = [];
let backend: (command: string, args: Record<string, unknown>) => unknown;

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

const SLACK = {
  id: "slack",
  name: "Slack",
  url: "https://app.slack.com/client",
  color: "#611f69",
  requiresServerUrl: false,
  urlHint: "",
};
const ZULIP = {
  id: "zulip",
  name: "Zulip",
  url: null,
  color: "#4f9dd9",
  requiresServerUrl: true,
  urlHint: "https://your-org.zulipchat.com",
};

function loadShell(): void {
  document.documentElement.innerHTML = shellHtml();
  mountShell();
}

function manager(): HTMLDialogElement {
  const node = document.querySelector<HTMLDialogElement>("#manager");
  if (!node) throw new Error("no services dialog");
  return node;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function presetButton(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("#preset-list .preset")].find(
    (button) => button.textContent === name,
  );
  if (!found) throw new Error(`no preset button ${name}`);
  return found;
}

function customInputs(): { name: HTMLInputElement; url: HTMLInputElement } {
  const inputs = document.querySelectorAll<HTMLInputElement>("#custom-fields input[type=text]");
  const name = inputs[0];
  const url = inputs[1];
  if (!name || !url) throw new Error("no custom fields");
  return { name, url };
}

function fillCustom(name: string, url: string): void {
  const fields = customInputs();
  fields.name.value = name;
  fields.name.dispatchEvent(new Event("input"));
  fields.url.value = url;
  fields.url.dispatchEvent(new Event("input"));
}

function activeCalls(id: string | null): number {
  return calls.filter(
    (call) => call.command === "set_active_service" && call.args.id === id,
  ).length;
}

const created: TestService = service("Mine", [], {
  id: "svc-mine",
  url: "https://mine.example.com/",
});

function view(
  overrides: Partial<TestSnapshot> & { services: TestService[] },
  activeId: string | null,
): TestSnapshot {
  return snapshot({ ...overrides, activeId });
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

describe("adding a preset", () => {
  it("closes the dialog and opens the new service", async () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id], { preset: "slack" });
    let added = false;
    backend = (command, args) => {
      if (command === "list_presets") return [SLACK];
      if (command === "get_state") {
        return view({ workspaces: [main], services: [slack] }, slack.id);
      }
      if (command === "set_active_service") {
        return view(
          { workspaces: [main], services: added ? [slack, created] : [slack] },
          (args.id as string | null) ?? null,
        );
      }
      if (command === "add_preset") {
        added = true;
        return view({ workspaces: [main], services: [slack, created] }, null);
      }
      throw new Error(`unexpected ${command}`);
    };

    await renderShell();
    document.querySelector<HTMLButtonElement>("#manage-button")?.click();
    await flush();
    expect(manager().open).toBe(true);
    // The dialog hides the service webview so it is not painted over.
    expect(activeCalls(null)).toBe(1);

    presetButton("Slack").click();
    await flush();

    expect(calls.some((call) => call.command === "add_preset")).toBe(true);
    expect(manager().open).toBe(false);
    // The new service is what comes back, not the one the dialog suspended.
    expect(calls.at(-1)).toMatchObject({
      command: "set_active_service",
      args: { id: created.id },
    });
    expect(activeCalls(slack.id)).toBe(0);
  });

  it("closes the dialog after the server URL step", async () => {
    const main = workspace("Main", { order: 0 });
    let added = false;
    backend = (command, args) => {
      if (command === "list_presets") return [ZULIP];
      if (command === "get_state") {
        return view({ workspaces: [main], services: [] }, null);
      }
      if (command === "set_active_service") {
        return view(
          { workspaces: [main], services: added ? [created] : [] },
          (args.id as string | null) ?? null,
        );
      }
      if (command === "add_preset") {
        added = true;
        return view({ workspaces: [main], services: [created] }, null);
      }
      throw new Error(`unexpected ${command}`);
    };

    await renderShell();
    document.querySelector<HTMLButtonElement>("#manage-button")?.click();
    await flush();

    presetButton("Zulip").click();
    const row = document.querySelector<HTMLElement>("#server-url-row");
    expect(row?.hidden).toBe(false);
    const input = document.querySelector<HTMLInputElement>("#server-url");
    if (!input) throw new Error("no server url input");
    input.value = "https://demo.zulipchat.com";
    document.querySelector<HTMLButtonElement>("#server-url-add")?.click();
    await flush();

    expect(calls.find((call) => call.command === "add_preset")?.args).toEqual({
      presetId: "zulip",
      serverUrl: "https://demo.zulipchat.com",
    });
    expect(manager().open).toBe(false);
    expect(calls.at(-1)).toMatchObject({
      command: "set_active_service",
      args: { id: created.id },
    });
    // The Zulip step is reset, so the next preset does not inherit the URL.
    expect(row?.hidden).toBe(true);
    expect(input.value).toBe("");
  });
});

describe("adding a custom service", () => {
  it("enables Add with a single workspace and files the service there", async () => {
    const main = workspace("Main", { order: 0 });
    let added = false;
    backend = (command, args) => {
      if (command === "list_presets") return [];
      if (command === "get_state") return view({ workspaces: [main], services: [] }, null);
      if (command === "set_active_service") {
        return view(
          { workspaces: [main], services: added ? [created] : [] },
          (args.id as string | null) ?? null,
        );
      }
      if (command === "add_custom") {
        added = true;
        return view({ workspaces: [main], services: [created] }, null);
      }
      throw new Error(`unexpected ${command}`);
    };

    await renderShell();
    document.querySelector<HTMLButtonElement>("#manage-button")?.click();
    await flush();

    const add = document.querySelector<HTMLButtonElement>("#custom-add");
    expect(add?.disabled).toBe(true);
    fillCustom("Mine", "https://mine.example.com/");
    // A single workspace is not a choice, so Add must not stay disabled.
    expect(add?.disabled).toBe(false);

    add?.click();
    await flush();

    const payload = calls.find((call) => call.command === "add_custom")?.args
      .service as { name: string; workspaces: string[]; allWorkspaces: boolean };
    expect(payload.name).toBe("Mine");
    expect(payload.workspaces).toEqual([main.id]);
    expect(payload.allWorkspaces).toBe(false);
    expect(manager().open).toBe(false);
    expect(calls.at(-1)).toMatchObject({
      command: "set_active_service",
      args: { id: created.id },
    });
  });

  it("creates one service when Add is clicked twice", async () => {
    const main = workspace("Main", { order: 0 });
    let release = () => {};
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let createdCount = 0;
    backend = (command, args) => {
      if (command === "list_presets") return [];
      if (command === "get_state") return view({ workspaces: [main], services: [] }, null);
      if (command === "set_active_service") {
        return view(
          { workspaces: [main], services: createdCount > 0 ? [created] : [] },
          (args.id as string | null) ?? null,
        );
      }
      if (command === "add_custom") {
        createdCount += 1;
        return gate.then(() => view({ workspaces: [main], services: [created] }, null));
      }
      throw new Error(`unexpected ${command}`);
    };

    await renderShell();
    document.querySelector<HTMLButtonElement>("#manage-button")?.click();
    await flush();
    fillCustom("Mine", "https://mine.example.com/");
    const add = document.querySelector<HTMLButtonElement>("#custom-add");
    add?.click();
    // The second click lands while the first add is still in flight.
    add?.click();
    release();
    await flush();

    expect(calls.filter((call) => call.command === "add_custom").length).toBe(1);
    expect(manager().open).toBe(false);
  });

  it("keeps the dialog open with an inline error when the backend rejects", async () => {
    const main = workspace("Main", { order: 0 });
    backend = (command) => {
      if (command === "list_presets") return [];
      if (command === "get_state") return view({ workspaces: [main], services: [] }, null);
      if (command === "add_custom") throw new Error("that URL is not http or https");
      throw new Error(`unexpected ${command}`);
    };

    await renderShell();
    document.querySelector<HTMLButtonElement>("#manage-button")?.click();
    await flush();
    fillCustom("Mine", "https://mine.example.com/");
    document.querySelector<HTMLButtonElement>("#custom-add")?.click();
    await flush();

    expect(manager().open).toBe(true);
    const error = document.querySelector<HTMLElement>("#custom-error");
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toContain("that URL is not http or https");
    // The values stay there for a retry.
    expect(customInputs().name.value).toBe("Mine");
    expect(calls.some((call) => call.command === "set_active_service")).toBe(false);
  });

  it("closes the dialog even when painting the new state throws", async () => {
    const main = workspace("Main", { order: 0 });
    let added = false;
    backend = (command, args) => {
      if (command === "list_presets") return [];
      if (command === "get_state") return view({ workspaces: [main], services: [] }, null);
      if (command === "set_active_service") {
        return view(
          { workspaces: [main], services: added ? [created] : [] },
          (args.id as string | null) ?? null,
        );
      }
      if (command === "add_custom") {
        added = true;
        // The service exists; every later paint fails because a static anchor
        // the sidebar needs is gone.
        document.querySelector("#service-list")?.remove();
        return view({ workspaces: [main], services: [created] }, null);
      }
      throw new Error(`unexpected ${command}`);
    };

    await renderShell();
    document.querySelector<HTMLButtonElement>("#manage-button")?.click();
    await flush();
    fillCustom("Mine", "https://mine.example.com/");
    document.querySelector<HTMLButtonElement>("#custom-add")?.click();
    await flush();

    expect(calls.some((call) => call.command === "add_custom")).toBe(true);
    expect(manager().open).toBe(false);
    // The failure is reported, and the new service is still brought up.
    expect(document.querySelector<HTMLElement>("#app-error")?.hidden).toBe(false);
    expect(calls.at(-1)).toMatchObject({
      command: "set_active_service",
      args: { id: created.id },
    });
  });
});

describe("editing a service", () => {
  it("closes the editor after saving and keeps it open with an inline error", async () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id], { preset: "slack" });
    const renamed = { ...slack, name: "Slack team" };
    let rejectNext = false;
    backend = (command) => {
      if (command === "list_presets") return [];
      if (command === "get_state") return view({ workspaces: [main], services: [slack] }, null);
      if (command === "update_service") {
        if (rejectNext) throw new Error("a service needs a name");
        return view({ workspaces: [main], services: [renamed] }, null);
      }
      throw new Error(`unexpected ${command}`);
    };

    await renderShell();
    const editButton = () =>
      [...document.querySelectorAll<HTMLButtonElement>(".card-actions button")].find(
        (button) => button.textContent === "Edit",
      );

    editButton()?.click();
    await flush();

    const dialog = document.querySelector<HTMLDialogElement>("#editor");
    expect(dialog?.open).toBe(true);
    const save = document.querySelector<HTMLButtonElement>("#editor-save");
    // A single workspace needs no checkbox, so Save must not stay disabled.
    expect(save?.disabled).toBe(false);

    // A rejected save keeps the dialog and the values for a retry.
    rejectNext = true;
    const name = document.querySelector<HTMLInputElement>("#editor-fields input[type=text]");
    if (!name) throw new Error("no editor name field");
    name.value = "Slack team";
    name.dispatchEvent(new Event("input"));
    document.querySelector<HTMLFormElement>("#editor-form")?.dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await flush();
    expect(dialog?.open).toBe(true);
    const error = document.querySelector<HTMLElement>("#editor-error");
    expect(error?.hidden).toBe(false);
    expect(error?.textContent).toContain("a service needs a name");
    expect((save?.disabled ?? true)).toBe(false);

    rejectNext = false;
    document.querySelector<HTMLFormElement>("#editor-form")?.dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await flush();
    expect(dialog?.open).toBe(false);
    // The edited name is what the desk shows.
    expect(document.querySelector(".card strong")?.textContent).toBe("Slack team");
  });

  it("closes the editor even when painting the saved state throws", async () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id], { preset: "slack" });
    backend = (command) => {
      if (command === "list_presets") return [];
      if (command === "get_state") return view({ workspaces: [main], services: [slack] }, null);
      if (command === "update_service") {
        document.querySelector("#service-list")?.remove();
        return view({ workspaces: [main], services: [{ ...slack, name: "Renamed" }] }, null);
      }
      throw new Error(`unexpected ${command}`);
    };

    await renderShell();
    [...document.querySelectorAll<HTMLButtonElement>(".card-actions button")]
      .find((button) => button.textContent === "Edit")
      ?.click();
    await flush();
    document.querySelector<HTMLFormElement>("#editor-form")?.dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await flush();

    expect(calls.length).toBeGreaterThan(0);
    expect(document.querySelector<HTMLDialogElement>("#editor")?.open).toBe(false);
    expect(document.querySelector<HTMLElement>("#app-error")?.hidden).toBe(false);
  });
});
