import { listen } from "@tauri-apps/api/event";
import { beforeEach, expect, it, vi } from "vitest";

import { invoke } from "../src/ipc";
import { renderShell } from "../src/shell";
import { service, snapshot, workspace } from "./fixtures";
import { shellHtml } from "./html";

beforeEach(() => {
  document.documentElement.innerHTML = shellHtml();
  vi.mocked(listen).mockClear();
});

it("updates the workspace rail, sidebar selection and Home from a native activation snapshot", async () => {
  const work = workspace("Work");
  const personal = workspace("Personal", { order: 1 });
  const slack = service("Slack", [work.id]);
  const mail = service("Mail", [personal.id]);
  const initial = snapshot({ workspaces: [work, personal], services: [slack, mail] });
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "list_presets") return [];
    if (command === "get_state") return initial;
    throw new Error(`unexpected backend call: ${command}`);
  });
  await renderShell();
  expect(document.querySelector<HTMLElement>("#dashboard")?.hidden).toBe(false);
  expect(document.querySelector("#service-list")?.textContent).toContain("Slack");

  const subscription = vi.mocked(listen).mock.calls.find(([event]) => event === "app-snapshot");
  expect(subscription).toBeDefined();
  const receive = subscription![1];
  receive({
    event: "app-snapshot",
    id: 1,
    payload: { ...initial, activeWorkspaceId: personal.id, activeId: mail.id, lastServiceId: mail.id },
  });

  expect(document.querySelector("#workspace-list .ws.active")?.getAttribute("data-workspace-id"))
    .toBe(personal.id);
  expect(document.querySelector("#service-list .svc.active")?.textContent).toContain("Mail");
  expect(document.querySelector("#service-list")?.textContent).not.toContain("Slack");
  expect(document.querySelector<HTMLElement>("#dashboard")?.hidden).toBe(true);
  expect(document.title).toBe("Mail - Rustbox");

  // A subsequent Home snapshot shows cards for the activated workspace.
  receive({ event: "app-snapshot", id: 2, payload: { ...initial, activeWorkspaceId: personal.id } });
  expect(document.querySelector<HTMLElement>("#dashboard")?.hidden).toBe(false);
  expect(document.querySelector("#dash-grid")?.textContent).toContain("Mail");
  expect(document.querySelector("#dash-grid")?.textContent).not.toContain("Slack");
});
