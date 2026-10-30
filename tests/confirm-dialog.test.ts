import { beforeEach, describe, expect, it, vi } from "vitest";

import { invoke } from "../src/ipc";
import { applyShellSnapshot, confirmDialog, mountShell } from "../src/shell";
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
  const node = document.querySelector<HTMLDialogElement>("#confirm-dialog");
  if (!node) throw new Error("no confirm dialog");
  return node;
}

function acceptButton(): HTMLButtonElement {
  const node = document.querySelector<HTMLButtonElement>("#confirm-accept");
  if (!node) throw new Error("no confirm button");
  return node;
}

function cancelButton(): HTMLButtonElement {
  const node = document.querySelector<HTMLButtonElement>("#confirm-cancel");
  if (!node) throw new Error("no cancel button");
  return node;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
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

describe("confirmDialog", () => {
  it("focuses Cancel for a destructive prompt and Confirm otherwise", async () => {
    const danger = confirmDialog({
      title: "Remove service?",
      message: "Remove Slack? Its saved session will be deleted.",
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
      danger: true,
    });
    await flush();
    expect(dialog().open).toBe(true);
    expect(document.activeElement).toBe(cancelButton());
    expect(acceptButton().classList.contains("danger")).toBe(true);
    cancelButton().click();
    await expect(danger).resolves.toBe(false);
    expect(dialog().open).toBe(false);

    const safe = confirmDialog({
      title: "Leave?",
      message: "You can come back.",
      confirmLabel: "Leave",
      cancelLabel: "Stay",
    });
    await flush();
    expect(document.activeElement).toBe(acceptButton());
    expect(acceptButton().textContent).toBe("Leave");
    expect(cancelButton().textContent).toBe("Stay");
    expect(acceptButton().classList.contains("danger")).toBe(false);
    acceptButton().click();
    await expect(safe).resolves.toBe(true);
  });

  it("confirms on Enter while Cancel is focused, and cancels on Escape or the backdrop", async () => {
    const pending = confirmDialog({
      title: "Delete workspace?",
      message: "Nothing is removed.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      danger: true,
    });
    await flush();
    cancelButton().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await expect(pending).resolves.toBe(true);

    const escaped = confirmDialog({
      title: "Delete workspace?",
      message: "Nothing is removed.",
      confirmLabel: "Delete",
      danger: true,
    });
    await flush();
    dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await expect(escaped).resolves.toBe(false);

    const backdrop = confirmDialog({
      title: "Delete workspace?",
      message: "Nothing is removed.",
      confirmLabel: "Delete",
      danger: true,
    });
    await flush();
    document.querySelector("#confirm-message")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(dialog().open).toBe(true);
    dialog().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await expect(backdrop).resolves.toBe(false);

    const closed = confirmDialog({
      title: "Delete workspace?",
      message: "Nothing is removed.",
      confirmLabel: "Delete",
      danger: true,
    });
    await flush();
    document.querySelector<HTMLButtonElement>("#confirm-close")?.click();
    await expect(closed).resolves.toBe(false);
  });
});

describe("remove service confirmation", () => {
  it("asks before deleting the session and leaves it in place on cancel", async () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id], { preset: "slack" });
    const nativeConfirm = vi.spyOn(window, "confirm").mockImplementation(() => {
      throw new Error("native confirm");
    });
    backend = (command, args) => {
      if (command === "remove_service") {
        return snapshot({ workspaces: [main], services: [], activeWorkspaceId: main.id, activeId: null });
      }
      throw new Error(`unexpected ${command} ${JSON.stringify(args)}`);
    };

    applyShellSnapshot(
      snapshot({ workspaces: [main], services: [slack], activeWorkspaceId: main.id, activeId: null }),
    );
    const remove = [...document.querySelectorAll<HTMLButtonElement>(".card-actions button")].find(
      (button) => button.textContent === "Remove",
    );
    remove?.click();
    await flush();

    expect(dialog().open).toBe(true);
    expect(document.querySelector("#confirm-title")?.textContent).toBe("Remove service?");
    expect(document.querySelector("#confirm-message")?.textContent).toBe(
      "Remove Slack? Its saved session will be deleted.",
    );
    expect(acceptButton().textContent).toBe("Remove");
    expect(calls.some((call) => call.command === "remove_service")).toBe(false);
    expect(nativeConfirm).not.toHaveBeenCalled();

    cancelButton().click();
    await flush();
    expect(dialog().open).toBe(false);
    expect(calls.some((call) => call.command === "remove_service")).toBe(false);

    remove?.click();
    await flush();
    acceptButton().click();
    await flush();
    expect(calls.map((call) => call.command)).toEqual(["remove_service"]);
    expect(calls[0]?.args.id).toBe(slack.id);
    expect(dialog().open).toBe(false);
  });

  it("suspends an active service for the prompt and restores it when Remove is cancelled", async () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id], { preset: "slack" });
    const view = (activeId: string | null) =>
      snapshot({
        workspaces: [main],
        services: [slack],
        activeWorkspaceId: main.id,
        activeId,
      });
    backend = (command, args) => {
      if (command !== "set_active_service") throw new Error(`unexpected ${command}`);
      return view((args.id as string | null) ?? null);
    };

    applyShellSnapshot(view(slack.id));
    const pending = confirmDialog({
      title: "Remove service?",
      message: "Remove Slack? Its saved session will be deleted.",
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
      danger: true,
    });
    await flush();
    expect(dialog().open).toBe(true);
    expect(calls).toEqual([{ command: "set_active_service", args: { id: null } }]);

    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    await pending;
    await flush();
    expect(dialog().open).toBe(false);
    expect(calls.at(-1)).toMatchObject({ command: "set_active_service", args: { id: slack.id } });
  });
});
