import { listen } from "@tauri-apps/api/event";
import { t } from "./i18n";
import { invoke } from "./ipc";

export interface PageToolsSnapshot {
  activeId: string | null;
  findServiceId?: string | null;
}

interface FindResult {
  requestId: number;
  current: number;
  total: number;
  failed: boolean;
}

let requestSequence = 0;

/** The 44px find strip is reserved by native content_bounds, never overlaid
 * on a child webview. The zoom toast lives in the always-visible sidebar. */
export class PageTools<S extends PageToolsSnapshot> {
  private activeId: string | null = null;
  private findId: string | null = null;
  private requestId = 0;
  private timer = 0;
  private zoomTimer = 0;
  private result: FindResult | null = null;
  private disposers: (() => void)[] = [];
  private disposed = false;
  private bar = document.querySelector<HTMLElement>("#find-bar")!;
  private input = document.querySelector<HTMLInputElement>("#find-input")!;
  private status = document.querySelector<HTMLElement>("#find-status")!;
  private toast = document.querySelector<HTMLElement>("#service-zoom")!;

  constructor(private apply: (snapshot: S) => void, private error: (error: unknown) => void) {
    this.input.addEventListener("input", () => this.schedule());
    document.querySelector("#find-next")!.addEventListener("click", () => this.search(1));
    document.querySelector("#find-previous")!.addEventListener("click", () => this.search(-1));
    document.querySelector("#find-close")!.addEventListener("click", () => this.close());
    window.addEventListener("keydown", this.keydown, true);
    this.disposers.push(() => window.removeEventListener("keydown", this.keydown, true));
  }

  async listen(): Promise<void> {
    const subscriptions = await Promise.all([
      listen<FindResult>("find-result", (event) => this.receiveResult(event.payload)),
      listen("open-find", () => this.focus()),
      listen<string>("find-page-loaded", (event) => {
        if (this.findId && event.payload === `svc-${this.findId}`) this.schedule();
      }),
      listen<{ id: string; zoom: number }>("service-zoom", (event) => {
        if (event.payload.id === this.activeId) this.showZoom(event.payload.zoom);
      }),
    ]);
    if (this.disposed) subscriptions.forEach((dispose) => dispose());
    else this.disposers.push(...subscriptions);
  }

  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.zoomTimer);
    this.disposers.forEach((dispose) => dispose());
  }

  sync(snapshot: S): void {
    const previous = this.findId;
    if (this.activeId !== snapshot.activeId) this.toast.hidden = true;
    this.activeId = snapshot.activeId;
    this.findId = snapshot.findServiceId === snapshot.activeId ? snapshot.findServiceId ?? null : null;
    this.bar.hidden = !this.findId;
    if (previous !== this.findId) {
      this.input.value = "";
      this.result = null;
      this.requestId = ++requestSequence;
      window.clearTimeout(this.timer);
      if (this.findId) this.focus();
    }
    this.paint();
  }

  focus(): void {
    if (!this.findId) return;
    this.input.focus();
    this.input.select();
  }

  receiveResult(result: FindResult): void {
    if (!this.findId || this.requestId !== result.requestId) return;
    this.result = result;
    this.paint();
  }

  private paint(): void {
    const result = this.result;
    this.status.textContent = !this.input.value ? "" : !result ? t("find.searching")
      : result.failed ? t("find.unavailable") : result.total === 0 ? t("find.noMatches")
        : t("find.matches", { current: result.current, total: result.total });
    for (const selector of ["#find-next", "#find-previous"]) {
      document.querySelector<HTMLButtonElement>(selector)!.disabled = !this.input.value || result?.total === 0;
    }
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.requestId = ++requestSequence;
    this.result = null;
    this.paint();
    this.timer = window.setTimeout(() => this.search(0), 120);
  }

  private search(direction: number): void {
    window.clearTimeout(this.timer);
    if (!this.findId) return;
    const requestId = this.requestId = ++requestSequence;
    this.result = null;
    this.paint();
    void invoke("find_in_service", {
      id: this.findId, query: this.input.value, direction, requestId,
    }).catch(() => {
      this.receiveResult({ requestId, current: 0, total: 0, failed: true });
    });
  }

  private close(): void {
    window.clearTimeout(this.timer);
    void invoke<S>("set_find_open", { open: false }).then(this.apply).catch(this.error);
  }

  private showZoom(zoom: number): void {
    window.clearTimeout(this.zoomTimer);
    this.toast.textContent = t("zoom.level", { percent: Math.round(zoom * 100) });
    this.toast.hidden = false;
    this.zoomTimer = window.setTimeout(() => { this.toast.hidden = true; }, 1500);
  }

  private keydown = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    if (this.findId && !document.querySelector("dialog[open]") && (
      event.key === "Escape" || (event.key === "Enter" && event.target === this.input)
    )) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") this.close();
      else this.search(event.shiftKey ? -1 : 1);
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const find = !event.shiftKey && event.key.toLowerCase() === "f";
    const zoom = ["+", "=", "-", "_", "0"].includes(event.key);
    if (!find && !zoom) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!this.activeId || document.querySelector("dialog[open]")) return;
    if (find && this.findId) {
      this.focus();
      return;
    }
    if (find && event.repeat) return;
    void invoke<S>("apply_service_shortcut", {
      key: event.key, ctrl: event.ctrlKey, meta: event.metaKey,
      shift: event.shiftKey, alt: event.altKey,
    }).then(this.apply).catch(this.error);
  };
}
