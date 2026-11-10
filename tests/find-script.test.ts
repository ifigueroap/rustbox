import fs from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dom: JSDOM;
let page: any;
let invoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  dom = new JSDOM("<body><p>Hello <b>world</b>. HELLO world.</p><p>İ and .* literal</p></body>", {
    url: "https://example.com", runScripts: "outside-only",
  });
  page = dom.window;
  invoke = vi.fn(async () => {});
  page.__TAURI_INTERNALS__ = { invoke };
  page.eval(fs.readFileSync("src-tauri/src/find.js", "utf8"));
});
afterEach(() => { dom.window.close(); });

function find(query: string, direction = 0): any {
  page.__rustboxFind(query, direction, 42);
  return invoke.mock.calls.at(-1)?.[1].result;
}

describe("injected find", () => {
  it("matches literal case-insensitive text across inline elements without changing the DOM", () => {
    const before = page.document.body.innerHTML;
    expect(find("hello world")).toMatchObject({ current: 1, total: 2, failed: false });
    expect(page.getSelection().toString()).toBe("Hello world");
    expect(find("hello world", 1)).toMatchObject({ current: 2, total: 2 });
    expect(page.getSelection().toString()).toBe("HELLO world");
    expect(find("hello world", 1)).toMatchObject({ current: 1, total: 2 });
    expect(find("hello world", -1)).toMatchObject({ current: 2, total: 2 });
    expect(page.document.body.innerHTML).toBe(before);
  });

  it("escapes regex characters, handles Unicode offsets, and clears only its own selection", () => {
    expect(find(".*")).toMatchObject({ total: 1, failed: false });
    expect(page.getSelection().toString()).toBe(".*");
    find("");
    expect(page.getSelection().toString()).toBe("");
    expect(find("and")).toMatchObject({ total: 1 });
    expect(page.getSelection().toString()).toBe("and");
    const range = page.document.createRange();
    range.selectNodeContents(page.document.querySelector("b"));
    page.getSelection().removeAllRanges();
    page.getSelection().addRange(range);
    find("");
    expect(page.getSelection().toString()).toBe("world");
  });

  it("excludes hidden content, scripts and editors and reports no matches", () => {
    page.document.body.innerHTML = '<p hidden>secret</p><div style="display:none">secret</div><script>secret</script><textarea>secret</textarea><div contenteditable>secret</div><p>shown</p>';
    expect(find("secret")).toMatchObject({ current: 0, total: 0, failed: false });
    expect(find("shown")).toMatchObject({ total: 1 });
    expect(invoke.mock.calls.at(-1)?.[1]).toEqual({ result: { requestId: 42, current: 1, total: 1, failed: false } });
  });

  it("uses CSS highlights when available and removes them on close", () => {
    page.CSS = { highlights: new Map() };
    page.Highlight = class extends Set { constructor(...ranges: any[]) { super(ranges); } };
    expect(find("hello")).toMatchObject({ total: 2, failed: false });
    expect(page.CSS.highlights.get("rustbox-find-all").size).toBe(2);
    expect(page.CSS.highlights.get("rustbox-find-active").size).toBe(1);
    expect(page.getSelection().toString()).toBe("");
    find("");
    expect(page.CSS.highlights.size).toBe(0);
  });

  it("rescans page changes on navigation to the next match", () => {
    find("hello");
    page.document.querySelector("p").textContent = "hello";
    expect(find("hello", 1)).toMatchObject({ current: 1, total: 1, failed: false });
    page.document.body.textContent = "gone";
    expect(find("hello", 1)).toMatchObject({ current: 0, total: 0, failed: false });
  });

  it("falls back to selection when the page blocks the highlight stylesheet", () => {
    page.CSS = { highlights: new Map() };
    page.Highlight = class extends Set {};
    const append = page.document.head.append.bind(page.document.head);
    vi.spyOn(page.document.head, "append").mockImplementation((node: any) => {
      Object.defineProperty(node, "sheet", { get: () => null });
      append(node);
    });
    expect(find("hello")).toMatchObject({ total: 2, failed: false });
    expect(page.getSelection().toString()).toBe("Hello");
  });
});

describe("injected service shortcuts", () => {
  it("prevents page/default handlers and forwards find and zoom once with either modifier", () => {
    page.eval(fs.readFileSync("src-tauri/src/inject.js", "utf8"));
    page.eval(fs.readFileSync("src-tauri/src/page_shortcuts.js", "utf8"));
    const received = vi.fn();
    page.document.addEventListener("keydown", received);
    for (const [key, ctrlKey, metaKey] of [["f", true, false], ["f", false, true], ["+", true, false], ["=", false, true], ["-", true, false], ["0", true, false]]) {
      const event = new page.KeyboardEvent("keydown", { key, ctrlKey, metaKey, bubbles: true, cancelable: true });
      page.document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(invoke.mock.calls.filter(([command]) => command === "apply_service_shortcut")).toHaveLength(6);
    expect(received).not.toHaveBeenCalled();
  });

  it("consumes Escape only while find is open and avoids duplicate handlers", () => {
    const script = fs.readFileSync("src-tauri/src/page_shortcuts.js", "utf8");
    page.eval(script);
    page.eval(script);
    const escape = () => {
      const event = new page.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      page.document.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(escape()).toBe(false);
    find("hello");
    expect(escape()).toBe(true);
    expect(invoke.mock.calls.filter(([command]) => command === "apply_service_shortcut")).toHaveLength(1);
    page.__rustboxFind("", 0, 0);
    expect(escape()).toBe(false);
  });

  it("relays supported chords from an iframe without an IPC bridge", async () => {
    const script = fs.readFileSync("src-tauri/src/page_shortcuts.js", "utf8");
    page.eval(script);
    const frame = page.document.createElement("iframe");
    page.document.body.append(frame);
    const child = frame.contentWindow;
    expect(child.__TAURI_INTERNALS__).toBeUndefined();
    child.eval(script);
    child.dispatchEvent(new child.KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true }));
    await new Promise((resolve) => page.setTimeout(resolve, 10));
    expect(invoke).toHaveBeenCalledWith("apply_service_shortcut", {
      key: "f", ctrl: true, meta: false, shift: false, alt: false,
    });
    invoke.mockClear();
    page.postMessage({ __rustboxPageShortcut: { key: "q", ctrl: true } }, "*");
    await new Promise((resolve) => page.setTimeout(resolve, 10));
    expect(invoke).not.toHaveBeenCalled();
  });
});
