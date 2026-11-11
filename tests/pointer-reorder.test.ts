import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../src/ipc";
import { applyShellSnapshot, mountShell } from "../src/shell";
import { service, snapshot, workspace } from "./fixtures";
import { shellHtml } from "./html";

const work = workspace("Work", { order: 0 });
const other = workspace("Other", { order: 1 });
const a = service("A", [work.id]);
const hidden = service("Hidden", [other.id]);
const b = service("B", [work.id]);
const current = snapshot({ workspaces: [work, other], services: [a, hidden, b], activeWorkspaceId: work.id });
const calls: { command: string; args: any }[] = [];

function pointer(row: HTMLElement, type: string, y: number, x = 10): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, button: 0, clientX: x, clientY: y });
  row.dispatchEvent(event);
}
function rows(selector = ".svc"): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>(selector)];
}
function geometry(items: HTMLElement[]): void {
  items.forEach((row, index) => {
    row.getBoundingClientRect = () => ({ top: index * 50, bottom: index * 50 + 40, height: 40 }) as DOMRect;
    row.setPointerCapture = vi.fn();
    row.releasePointerCapture = vi.fn();
  });
}
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}
beforeEach(() => {
  calls.length = 0;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    calls.push({ command, args });
    return current;
  });
  document.documentElement.innerHTML = shellHtml();
  mountShell();
  applyShellSnapshot(current);
  geometry(rows());
  geometry(rows(".ws"));
});

it("captures on press, waits for the threshold, then submits a full filtered permutation without activation", async () => {
  const [first, last] = rows();
  pointer(first, "pointerdown", 20);
  expect(first.setPointerCapture).toHaveBeenCalledWith(1);
  pointer(first, "pointermove", 23);
  expect(first.classList.contains("dragging")).toBe(false);
  pointer(first, "pointermove", 85);
  expect(last.classList.contains("drop-target-after")).toBe(true);
  pointer(first, "pointerup", 85);
  first.click();
  await flush();
  expect(calls).toEqual([{ command: "reorder_services", args: { ids: [hidden.id, b.id, a.id] } }]);
});

it("keeps ordinary clicks working", async () => {
  const [first] = rows();
  pointer(first, "pointerdown", 20);
  pointer(first, "pointerup", 20);
  first.click();
  await flush();
  expect(calls.some((call) => call.command === "set_active_service" && call.args.id === a.id)).toBe(true);
  expect(calls.some((call) => call.command === "reorder_services")).toBe(false);
});

it.each(["pointercancel", "lostpointercapture", "Escape"])("cancels on %s and accepts the next gesture", async (cancel) => {
  const [first] = rows();
  pointer(first, "pointerdown", 20);
  pointer(first, "pointermove", 85);
  if (cancel === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  else pointer(first, cancel, 85);
  pointer(first, "pointerup", 85);
  expect(document.querySelector(".dragging, .drop-target-after, .drop-target-before")).toBeNull();
  expect(calls).toEqual([]);
  pointer(first, "pointerdown", 20);
  pointer(first, "pointermove", 85);
  pointer(first, "pointerup", 85);
  await flush();
  expect(calls[0]?.command).toBe("reorder_services");
});

it("reorders the workspace rail with the same pointer gesture", async () => {
  const [first] = rows(".ws");
  pointer(first, "pointerdown", 20);
  pointer(first, "pointermove", 85);
  pointer(first, "pointerup", 85);
  first.click();
  await flush();
  expect(calls).toEqual([{ command: "reorder_workspaces", args: { ids: [other.id, work.id] } }]);
});
