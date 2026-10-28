import { afterEach, vi } from "vitest";

// The shell imports @tauri-apps/api, which talks to the native IPC bridge. In
// jsdom there is no bridge, so the modules are stubbed. Tests that need a
// backend stub `src/ipc.ts` instead, which leaves the shell's own code intact.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: class {},
  MenuItem: class {},
  CheckMenuItem: class {},
  PredefinedMenuItem: class {},
  Submenu: class {},
}));

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
