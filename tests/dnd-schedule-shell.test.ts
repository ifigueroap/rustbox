import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../src/ipc";
import { applyShellSnapshot, mountShell, openWorkspaceEditor, saveWorkspaceEditor } from "../src/shell";
import { snapshot, workspace } from "./fixtures";
import { shellHtml } from "./html";
import { setLocale } from "../src/i18n";
const schedule = { enabled: true, rules: [{ days: ["fri"], startMinute: 1140, endMinute: 480 }] };
beforeEach(() => {
  setLocale("en");
  vi.mocked(invoke).mockReset();
  document.documentElement.innerHTML = shellHtml();
  mountShell();
});
it("loads and saves the global schedule from Settings and reflects effective DnD", async () => {
  applyShellSnapshot({ ...snapshot(), doNotDisturb: true, dndSchedule: schedule });
  expect(document.querySelector("#dnd-button")?.getAttribute("aria-pressed")).toBe("true");
  document.querySelector<HTMLButtonElement>("#settings-button")!.click();
  await vi.waitFor(() => expect(document.querySelector("#settings .schedule-editor")).not.toBeNull());
  const editor = document.querySelector("#settings .schedule-editor")!;
  expect(editor.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
  expect(editor.querySelector('[aria-pressed="true"]')?.textContent).toBe("Fri");
  vi.mocked(invoke).mockResolvedValue({ ...snapshot(), dndSchedule: schedule });
  const buttons = [...editor.querySelectorAll<HTMLButtonElement>("button")];
  buttons.find(b => b.textContent === "Save schedule")!.click();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("set_dnd_schedule", { workspaceId: null, schedule }));
});
it("saves the workspace schedule and preserves its effective DnD mark", async () => {
  const main = { ...workspace("Main"), dnd: true, dndSchedule: schedule };
  const other = workspace("Other", { order: 1 });
  const state = snapshot({ workspaces: [main, other], activeWorkspaceId: main.id });
  applyShellSnapshot(state);
  expect(document.querySelector(".ws-dnd")).not.toBeNull();
  openWorkspaceEditor(main, "rename");
  const editor = document.querySelector("#workspace-editor .schedule-editor")!;
  editor.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked = false;
  vi.mocked(invoke).mockResolvedValue(state);
  await saveWorkspaceEditor();
  expect(invoke).toHaveBeenCalledWith("set_dnd_schedule", { workspaceId: main.id, schedule: { ...schedule, enabled: false } });
});
