import fs from "node:fs";
import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";

function setup(native = false) {
  const dom = new JSDOM("<body><audio></audio></body>", { url: "http://localhost", runScripts: "outside-only" });
  const page = dom.window as any;
  page.__TAURI_INTERNALS__ = { invoke: vi.fn(async () => {}) };
  page.__rustboxNativeAudio = native;
  class Node {
    target: any;
    connect(target: any) { this.target = target; return target; }
    disconnect(target: any) { this.target = target; }
  }
  class Context {
    state = "running";
    destination = new Node();
    resume = vi.fn(async () => {});
    suspend = vi.fn(async () => {});
    createGain() { return Object.assign(new Node(), { gain: { value: 1 } }); }
    addEventListener() {}
  }
  page.AudioNode = Node;
  page.AudioContext = Context;
  const play = vi.fn(async () => {});
  page.HTMLMediaElement.prototype.play = play;
  page.eval(fs.readFileSync("src-tauri/src/inject.js", "utf8"));
  return { dom, page, Node, play };
}

it("restores detached and DOM media, preserving the page's original mute state", async () => {
  const { dom, page } = setup();
  const existing = new page.Audio();
  const ownMuted = page.document.querySelector("audio");
  ownMuted.muted = true;
  await existing.play();
  page.__rustboxSetSound(false);
  const createdMuted = new page.Audio();
  expect(existing.muted).toBe(true);
  expect(createdMuted.muted).toBe(true);
  page.__rustboxSetSound(true);
  expect(existing.muted).toBe(false);
  expect(createdMuted.muted).toBe(false);
  expect(ownMuted.muted).toBe(true);
  await createdMuted.play();
  expect(createdMuted.muted).toBe(false);
  dom.window.close();
});

it("gates existing and new Web Audio output without changing context lifecycle", async () => {
  const { dom, page, Node } = setup();
  const ctx = new page.AudioContext();
  const source = new Node();
  source.connect(ctx.destination);
  const output = source.target;
  expect(output.gain.value).toBe(1);
  page.__rustboxSetSound(false);
  expect(output.gain.value).toBe(0);
  const during = new page.AudioContext();
  const second = new Node();
  second.connect(during.destination);
  expect(second.target.gain.value).toBe(0);
  await during.resume();
  page.__rustboxSetSound(true);
  expect(output.gain.value).toBe(1);
  expect(second.target.gain.value).toBe(1);
  expect(ctx.suspend).not.toHaveBeenCalled();
  expect(during.resume).toHaveBeenCalledOnce();
  source.disconnect(ctx.destination);
  expect(source.target).toBe(output);
  dom.window.close();
});

it("leaves page media and context APIs alone on engine-muted platforms", () => {
  const { dom, page, play } = setup(true);
  expect(page.__rustboxSetSound).toBeUndefined();
  expect(page.HTMLMediaElement.prototype.play).toBe(play);
  dom.window.close();
});

it("installs the legacy WebView2 fallback on demand exactly once", () => {
  const { dom, page } = setup(true);
  page.__rustboxInstallSound();
  const play = page.HTMLMediaElement.prototype.play;
  page.__rustboxInstallSound();
  expect(page.HTMLMediaElement.prototype.play).toBe(play);
  page.__rustboxSetSound(false);
  const audio = new page.Audio();
  expect(audio.muted).toBe(true);
  page.__rustboxSetSound(true);
  expect(audio.muted).toBe(false);
  dom.window.close();
});
