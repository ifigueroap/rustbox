import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../src/ipc";
import { applyShellSnapshot, mountShell } from "../src/shell";
import { snapshot } from "./fixtures";
import { shellHtml } from "./html";

const mock = vi.mocked(invoke);
const click = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`)!.click();
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
const status = () => document.querySelector("#backup-status")!.textContent;
const choice = () => document.querySelector<HTMLDialogElement>("#import-choice")!;

beforeEach(() => {
  mock.mockReset();
  mock.mockImplementation(async (command) => {
    if (command === "prepare_config_import" || command === "export_config") return true;
    return snapshot();
  });
  document.documentElement.innerHTML = shellHtml();
  mountShell();
  applyShellSnapshot(snapshot());
  click("settings-button");
});

it("exports from Settings and displays success", async () => {
  click("config-export"); await flush();
  expect(mock).toHaveBeenCalledWith("export_config");
  expect(status()).toContain("exported");
});

it("validates before offering Merge, Replace and Cancel", async () => {
  click("config-import"); await flush();
  expect(mock).toHaveBeenCalledWith("prepare_config_import");
  expect(choice().open).toBe(true);
  expect([...choice().querySelectorAll("button")].map((b) => b.value)).toEqual(["cancel", "merge", "replace"]);
  choice().querySelector<HTMLButtonElement>('button[value="merge"]')!.click(); await flush();
  expect(mock).toHaveBeenCalledWith("apply_config_import", { mode: "merge" });
  expect(status()).toContain("imported");
});

it("requires destructive confirmation before replacing", async () => {
  click("config-import"); await flush();
  choice().querySelector<HTMLButtonElement>('button[value="replace"]')!.click(); await flush();
  const confirm = document.querySelector<HTMLDialogElement>("#confirm-dialog")!;
  expect(confirm.open).toBe(true);
  expect(document.activeElement?.id).toBe("confirm-cancel");
  expect(mock).not.toHaveBeenCalledWith("apply_config_import", { mode: "replace" });
  click("confirm-accept"); await flush();
  expect(mock).toHaveBeenCalledWith("apply_config_import", { mode: "replace" });
});

it("cancels a rejected replacement", async () => {
  click("config-import"); await flush(); choice().querySelector<HTMLButtonElement>('button[value="replace"]')!.click(); await flush();
  click("confirm-cancel"); await flush();
  expect(mock).toHaveBeenCalledWith("apply_config_import", { mode: "cancel" });
});

it("clears a cancelled import", async () => {
  click("config-import"); await flush(); choice().querySelector<HTMLButtonElement>('button[value="cancel"]')!.click(); await flush();
  expect(mock).toHaveBeenCalledWith("apply_config_import", { mode: "cancel" });
  expect(status()).toBe("");
});

it("shows localized errors inside Settings without offering an invalid import", async () => {
  mock.mockRejectedValue(new Error("private file contents must not appear"));
  click("config-import"); await flush();
  expect(choice().open).toBe(false);
  expect(status()).toContain("Could not complete");
  expect(status()).not.toContain("private");
  expect(document.querySelector<HTMLButtonElement>("#config-import")!.disabled).toBe(false);
});

it("treats cancelled native dialogs as cancellation", async () => {
  mock.mockResolvedValue(false);
  click("config-import"); await flush();
  expect(choice().open).toBe(false); expect(status()).toBe("");
  click("config-export"); await flush(); expect(status()).toBe("");
});
