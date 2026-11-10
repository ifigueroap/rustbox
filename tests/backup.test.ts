import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../src/ipc";
import { applyShellSnapshot, mountShell } from "../src/shell";
import { snapshot } from "./fixtures";
import { shellHtml } from "./html";
import { setLocale } from "../src/i18n";
import { en } from "../src/i18n/en";
import { es } from "../src/i18n/es";

const mock = vi.mocked(invoke);
const click = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`)!.click();
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
const status = () => document.querySelector("#backup-status")!.textContent;
const choice = () => document.querySelector<HTMLDialogElement>("#import-choice")!;

beforeEach(() => {
  setLocale("en");
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

const errorCodes = [
  "shape", "version", "size", "workspaces", "id", "url", "name",
  "membership", "icon", "io", "dialog", "mode", "pending", "userAgent",
] as const;

it.each(errorCodes.flatMap((code) => (["en", "es"] as const).map((locale) => ({ code, locale }))))(
  "shows the specific $locale import error for $code",
  async ({ code, locale }) => {
    setLocale(locale);
    mock.mockRejectedValue(code);
    click("config-import"); await flush();
    expect(status()).toBe((locale === "en" ? en : es)[`backup.error.${code}`]);
    expect(choice().open).toBe(false);
    expect(document.querySelector<HTMLButtonElement>("#config-import")!.disabled).toBe(false);
  },
);

it("shows a specific export error from an Error rejection", async () => {
  mock.mockRejectedValue(new Error("io"));
  click("config-export"); await flush();
  expect(status()).toBe(en["backup.error.io"]);
});

it("shows a specific error when applying a validated import fails", async () => {
  click("config-import"); await flush();
  mock.mockRejectedValue("io");
  choice().querySelector<HTMLButtonElement>('button[value="merge"]')!.click(); await flush();
  expect(status()).toBe(en["backup.error.io"]);
});

it.each(["unknown", "/private/backup.json", "toString", { code: "url" }])(
  "uses the generic message for unknown rejection %j",
  async (error) => {
    mock.mockRejectedValue(error);
    click("config-import"); await flush();
    expect(status()).toBe(en["backup.error"]);
  },
);
