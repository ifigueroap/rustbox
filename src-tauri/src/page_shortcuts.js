// Installed in all frames so these chords work even inside an embedded login
// or editor. The main-page injection keeps its existing top-frame scope.
(() => {
  if (window.__rustboxPageShortcuts) return;
  window.__rustboxPageShortcuts = true;
  function send(chord) {
    if (window !== window.top) {
      // Tauri's IPC bridge is top-frame-only on WebKit. Relay just the chord,
      // never page content, to the service's own top frame on every engine.
      window.top.postMessage({ __rustboxPageShortcut: chord }, "*");
      return;
    }
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (invoke) Promise.resolve(invoke("apply_service_shortcut", chord)).catch(() => {});
  }
  if (window === window.top) {
    window.addEventListener("message", (event) => {
      const chord = event.data?.__rustboxPageShortcut;
      if (!chord || typeof chord.key !== "string" || chord.alt || !(chord.ctrl === true || chord.meta === true)) return;
      const find = !chord.shift && chord.key.toLowerCase() === "f";
      const zoom = ["+", "=", "-", "_", "0"].includes(chord.key);
      if (find || zoom) send({
        key: chord.key, ctrl: chord.ctrl === true, meta: chord.meta === true,
        shift: chord.shift === true, alt: false,
      });
    });
  }
  window.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    const modified = event.ctrlKey || event.metaKey;
    const find = modified && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f";
    const zoom = modified && !event.altKey && ["+", "=", "-", "_", "0"].includes(event.key);
    const close = window.__rustboxFindOpen && event.key === "Escape" && !modified && !event.altKey && !event.shiftKey;
    if (!find && !zoom && !close) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (find && event.repeat) return;
    send({
      key: event.key, ctrl: event.ctrlKey, meta: event.metaKey,
      shift: event.shiftKey, alt: event.altKey,
    });
  }, true);
})();
