import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { invoke } from "../src/ipc";
import { applyShellSnapshot, mountShell } from "../src/shell";
import { en } from "../src/i18n/en";
import { es } from "../src/i18n/es";
import { service, snapshot, workspace } from "./fixtures";
import { shellHtml } from "./html";

type MenuRecord = { text?: string; action?: () => void };
const menus = () => (globalThis as { __rustboxMenus?: MenuRecord[][] }).__rustboxMenus!;
const calls: { command: string; args: Record<string, unknown> }[] = [];
let backend: (command: string, args: Record<string, unknown>) => unknown;
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}
function button(selector: string): HTMLButtonElement {
  const node = document.querySelector<HTMLButtonElement>(selector);
  if (!node) throw new Error(`Missing ${selector}`);
  return node;
}
const main = workspace("Work");
const personal = workspace("Personal");
const slack = service("Slack", [main.id, personal.id]);
const other = service("Other", [main.id]);
const view = (activeId: string | null = null, spellcheckEnabled = true) => snapshot({
  services: [{ ...slack, spellcheckEnabled }, other], workspaces: [main, personal], activeWorkspaceId: main.id, activeId,
});
async function menu(): Promise<MenuRecord[]> {
  const node = document.querySelector("#service-list .svc");
  if (!node) throw new Error("missing service");
  node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await flush();
  return menus().at(-1)!;
}
function action(menu: MenuRecord[], text: string): void {
  const item = menu.find((item) => item.text === text);
  if (!item?.action) throw new Error(`Missing action ${text}`);
  item.action();
}
async function openEditor(): Promise<void> {
  const edit = [...document.querySelectorAll<HTMLButtonElement>(".card-actions button")].find((b) => b.textContent === "Edit");
  if (!edit) throw new Error("missing Edit");
  edit.click();
  await flush();
}

beforeEach(() => {
  calls.length = 0;
  menus().length = 0;
  backend = (command, args) => {
    if (command === "set_active_service") return view(args.id as string | null);
    return view();
  };
  vi.mocked(invoke).mockReset().mockImplementation(async (command, args) => {
    const payload = (args ?? {}) as Record<string, unknown>;
    calls.push({ command, args: payload });
    return await backend(command, payload);
  });
  document.documentElement.innerHTML = shellHtml();
  mountShell();
  applyShellSnapshot(view());
});

describe("service maintenance", () => {
  it("offers all three context actions and clears only the shared service id", async () => {
    const entries = await menu();
    expect(entries.map((item) => item.text)).toEqual(expect.arrayContaining(["Clear cache and reload", "Log out (clear session)", "Spellcheck"]));
    action(entries, "Clear cache and reload");
    await flush();
    expect(calls).toEqual([{ command: "maintain_service", args: { id: slack.id, session: false } }]);
    expect(document.querySelector<HTMLDialogElement>("#confirm-dialog")?.open).toBe(false);
  });

  it("confirms logout in-app, defaults to Cancel, and never clears on cancellation", async () => {
    const native = vi.spyOn(window, "confirm").mockImplementation(() => { throw new Error("native dialog"); });
    const entries = await menu();
    action(entries, "Log out (clear session)");
    await flush();
    expect(document.querySelector<HTMLDialogElement>("#confirm-dialog")?.open).toBe(true);
    expect(document.querySelector("#confirm-message")?.textContent).toContain("Slack");
    expect(document.activeElement).toBe(button("#confirm-cancel"));
    expect(calls).toEqual([]);
    button("#confirm-cancel").click();
    await flush();
    expect(calls).toEqual([]);
    action(entries, "Log out (clear session)");
    await flush();
    button("#confirm-accept").click();
    await flush();
    expect(calls).toEqual([{ command: "maintain_service", args: { id: slack.id, session: true } }]);
    expect(native).not.toHaveBeenCalled();
  });

  it("holds the active service hidden until clearing settles, including failures", async () => {
    applyShellSnapshot(view(slack.id));
    let fail!: (error: Error) => void;
    backend = (command, args) => {
      if (command === "set_active_service") return view(args.id as string | null);
      return new Promise((_, reject) => { fail = reject; });
    };
    action(await menu(), "Clear cache and reload");
    await flush();
    expect(calls.map((call) => call.command)).toEqual(["set_active_service", "maintain_service"]);
    expect(calls[0]?.args.id).toBeNull();
    fail(new Error("clear failed"));
    await flush();
    expect(calls.at(-1)).toEqual({ command: "set_active_service", args: { id: slack.id } });
    expect(document.querySelector("#app-error-text")?.textContent).toBe("clear failed");
  });

  it("provides maintenance in the editor and blocks duplicate clicks", async () => {
    await openEditor();
    const clear = button('#editor-fields [data-service-maintenance="false"]');
    expect(clear.closest("details")).not.toBeNull();
    let finish!: () => void;
    backend = () => new Promise((resolve) => { finish = () => resolve(view()); });
    clear.click();
    clear.click();
    await flush();
    expect(clear.disabled).toBe(true);
    expect(calls.filter((call) => call.command === "maintain_service")).toHaveLength(1);
    finish();
    await flush();
    expect(clear.disabled).toBe(false);
    expect(document.querySelector<HTMLDialogElement>("#editor")?.open).toBe(true);
    button('#editor-fields [data-service-maintenance="true"]').click();
    await flush();
    button("#confirm-cancel").click();
    await flush();
    expect(calls.filter((call) => call.command === "maintain_service")).toHaveLength(1);
  });

  it("persists spellcheck from the editor and reverts the checkbox after an error", async () => {
    await openEditor();
    const check = document.querySelector<HTMLInputElement>("#editor-fields [data-service-spellcheck]")!;
    expect(check.checked).toBe(true);
    backend = () => view(null, false);
    check.click();
    await flush();
    expect(calls.at(-1)).toEqual({ command: "set_service_spellcheck", args: { id: slack.id, enabled: false } });
    expect(check.checked).toBe(false);
    backend = () => { throw new Error("save failed"); };
    check.click();
    await flush();
    expect(check.checked).toBe(false);
    expect(check.disabled).toBe(false);
  });

  it("toggles spellcheck from the sidebar menu", async () => {
    action(await menu(), "Spellcheck");
    await flush();
    expect(calls.at(-1)).toEqual({ command: "set_service_spellcheck", args: { id: slack.id, enabled: false } });
  });

  it("keeps English and Spanish maintenance strings and placeholders in sync", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    const keys = ["service.spellcheck", "service.maintenance", "service.clearCache", "service.logout", "service.logoutTitle", "service.logoutConfirm"] as const;
    for (const key of keys) {
      expect(en[key]).toBeTruthy();
      expect(es[key]).toBeTruthy();
      expect(es[key].match(/\{\w+\}/g)).toEqual(en[key].match(/\{\w+\}/g));
    }
  });

  it("applies explicit spellcheck to existing and dynamic editable elements", async () => {
    const script = readFileSync("src-tauri/src/spellcheck.js", "utf8");
    const area = document.createElement("textarea");
    area.spellcheck = true;
    document.body.append(area);
    window.eval(script.replace("__RUSTBOX_SPELLCHECK__", "false"));
    expect(area.spellcheck).toBe(false);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.append(editable);
    await flush();
    expect(editable.spellcheck).toBe(false);
    area.spellcheck = true;
    area.setAttribute("spellcheck", "true");
    await flush();
    expect(area.spellcheck).toBe(false);
  });
});
