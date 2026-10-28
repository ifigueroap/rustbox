import { afterEach, vi } from "vitest";

// The shell imports @tauri-apps/api, which talks to the native IPC bridge. In
// jsdom there is no bridge, so the modules are stubbed. Tests that need a
// backend stub `src/ipc.ts` instead, which leaves the shell's own code intact.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/api/menu", () => {
  type MenuRecord = {
    text?: string;
    enabled?: boolean;
    action?: () => void;
    kind: string;
  };
  const menus: MenuRecord[][] = [];
  (globalThis as { __rustboxMenus?: MenuRecord[][] }).__rustboxMenus = menus;

  class MenuItem {
    text?: string;
    enabled: boolean;
    action?: () => void;
    kind = "item";
    constructor(options: { text?: string; enabled?: boolean; action?: () => void }) {
      this.text = options.text;
      this.enabled = options.enabled ?? true;
      this.action = options.action;
    }
    static async new(options: { text?: string; enabled?: boolean; action?: () => void }) {
      return new MenuItem(options);
    }
    async close() {}
  }

  class CheckMenuItem extends MenuItem {
    kind = "check";
    static async new(options: { text?: string; enabled?: boolean; action?: () => void }) {
      return new CheckMenuItem(options);
    }
  }

  class PredefinedMenuItem {
    kind = "predefined";
    item?: string;
    enabled = true;
    static async new(options: { item?: string }) {
      const node = new PredefinedMenuItem();
      node.item = options.item;
      return node;
    }
    async close() {}
  }

  class Menu {
    items: MenuItem[];
    constructor(items: MenuItem[]) {
      this.items = items;
      menus.push(items as unknown as MenuRecord[]);
    }
    static async new(options: { items: MenuItem[] }) {
      return new Menu(options.items);
    }
    async popup() {}
    async close() {}
  }

  return { Menu, MenuItem, CheckMenuItem, PredefinedMenuItem, Submenu: class {} };
});

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class {},
}));

vi.mock("../src/ipc", () => ({
  invoke: vi.fn(async (command: string) => {
    throw new Error(`unexpected backend call: ${command}`);
  }),
}));

// jsdom implements `<dialog>` markup but not its modal methods. The shell only
// needs `open` to be tracked faithfully, which is what these stand in for.
for (const proto of [HTMLDialogElement.prototype]) {
  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
      (this as HTMLDialogElement & { open: boolean }).open = true;
      this.dispatchEvent(new Event("open"));
    };
  }
  if (typeof proto.close !== "function" || !/\[native code\]/.test(String(proto.close))) {
    proto.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
      (this as HTMLDialogElement & { open: boolean }).open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
}

afterEach(() => {
  document.body.replaceChildren();
});
