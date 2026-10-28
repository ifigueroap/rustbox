import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyShellSnapshot, mountShell } from "../src/shell";
import { service, snapshot, workspace } from "./fixtures";
import { shellHtml } from "./html";

function loadShell(): void {
  document.documentElement.innerHTML = shellHtml();
  mountShell();
}

function avatars(selector: string): HTMLImageElement[] {
  return [...document.querySelectorAll<HTMLImageElement>(`${selector} img`)];
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  loadShell();
});

describe("service icons", () => {
  it("paints the bundled Slack mark in the sidebar and on the card", () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id], { preset: "slack" });
    applyShellSnapshot(snapshot({ workspaces: [main], services: [slack] }));

    const sidebar = avatars("#service-list .svc .avatar");
    const card = avatars("#dash-grid .card .avatar");
    expect(sidebar.at(0)?.getAttribute("src")).toBe("/brands/slack.png");
    expect(card.at(0)?.getAttribute("src")).toBe("/brands/slack.png");
    // No workspace icon reported yet, so the brand mark is what shows.
    expect(sidebar.at(0)?.getAttribute("src")).not.toMatch(/^https?:/);
  });

  it("falls back to the bundled brand mark when a reported workspace icon fails", () => {
    const main = workspace("Main", { order: 0 });
    const slack = service("Slack", [main.id], {
      preset: "slack",
      workspaceIcon: "https://files.slack.com/broken.png",
    });
    applyShellSnapshot(snapshot({ workspaces: [main], services: [slack] }));

    const image = avatars("#service-list .svc .avatar").at(0);
    expect(image?.getAttribute("src")).toBe("https://files.slack.com/broken.png");
    // The image error path retries the bundled mark rather than leaving a hole.
    image?.dispatchEvent(new Event("error"));
    expect(image?.getAttribute("src")).toBe("/brands/slack.png");
  });

  it("keeps a Slack member icon in the sidebar after the rail appears", () => {
    const main = workspace("Main", { order: 0 });
    const spotmind = workspace("Spotmind", { order: 1 });
    const slack = service("Slack", [main.id, spotmind.id], { preset: "slack" });
    applyShellSnapshot(snapshot({ workspaces: [main], services: [slack] }));
    applyShellSnapshot(
      snapshot({ workspaces: [main, spotmind], services: [slack], activeWorkspaceId: spotmind.id }),
    );
    // The shared service is in the active workspace, so it keeps its icon.
    expect(avatars("#service-list .svc .avatar").at(0)?.getAttribute("src")).toBe(
      "/brands/slack.png",
    );
  });

  it("uses a local: icon when one is stored", () => {
    const main = workspace("Main", { order: 0 });
    const custom = service("Custom", [main.id], { icon: "local:abc.png" });
    applyShellSnapshot(snapshot({ workspaces: [main], services: [custom] }));
    // The token is not hydrated in this test, so the letter fallback shows
    // rather than an empty tile.
    const avatar = document.querySelector<HTMLElement>("#service-list .svc .avatar");
    expect(avatar?.querySelector("img")).toBeNull();
    expect(avatar?.textContent).toBe("C");
  });
});
