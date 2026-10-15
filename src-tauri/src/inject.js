(() => {
  "use strict";
  if (window.__rustboxInstalled) return;
  window.__rustboxInstalled = true;

  // Values are JSON literals produced by policy.rs.
  const HOME_HOST = __RBX_HOME_HOST__;
  const EXTRA_HOSTS = __RBX_EXTRA_HOSTS__;
  const AUTH_DEDICATED = __RBX_AUTH_DEDICATED__;
  const AUTH_SUFFIXES = __RBX_AUTH_SUFFIXES__;
  const AUTH_PATH_HOSTS = __RBX_AUTH_PATH_HOSTS__;
  const AUTH_PATH_MARKERS = __RBX_AUTH_PATH_MARKERS__;
  const MULTI_TLDS = __RBX_MULTI_TLDS__;
  const BRIDGE = "\u2063";

  function normalizeHost(host) {
    return String(host || "").replace(/\.$/, "").toLowerCase();
  }

  function hostMatches(host, allowed) {
    host = normalizeHost(host);
    allowed = normalizeHost(allowed);
    if (!host || !allowed) return false;
    return host === allowed || host.endsWith("." + allowed);
  }

  function registrable(host) {
    host = normalizeHost(host);
    if (!host || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
    const parts = host.split(".").filter(Boolean);
    if (parts.length <= 2) return host;
    const lastTwo = parts.slice(-2).join(".");
    if (MULTI_TLDS.indexOf(lastTwo) !== -1) return parts.slice(-3).join(".");
    return lastTwo;
  }

  function isRelated(url) {
    const host = normalizeHost(url.hostname);
    if (!host) return false;
    if (HOME_HOST && registrable(host) === registrable(HOME_HOST)) return true;
    return EXTRA_HOSTS.some((allowed) => hostMatches(host, allowed));
  }

  function isAuth(url) {
    const host = normalizeHost(url.hostname);
    if (!host) return false;
    if (AUTH_DEDICATED.some((allowed) => hostMatches(host, allowed))) return true;
    if (AUTH_SUFFIXES.some((allowed) => hostMatches(host, allowed))) return true;
    const path = String(url.pathname || "").toLowerCase();
    const pathMatch = AUTH_PATH_MARKERS.some((marker) => path.indexOf(marker) !== -1);
    return pathMatch && AUTH_PATH_HOSTS.some((allowed) => hostMatches(host, allowed));
  }

  const bridgeQueue = [];
  let bridgePumping = false;

  function titleBridge(cmd, args) {
    bridgeQueue.push({ cmd, args });
    pumpBridge();
  }

  function pumpBridge() {
    if (bridgePumping || bridgeQueue.length === 0) return;
    bridgePumping = true;
    const item = bridgeQueue[0];
    let payload = "";
    try {
      payload = JSON.stringify(item);
    } catch (error) {
      bridgeQueue.shift();
      bridgePumping = false;
      pumpBridge();
      return;
    }
    if (payload.length > 1800) {
      bridgeQueue.shift();
      bridgePumping = false;
      pumpBridge();
      return;
    }
    const previous = document.title && document.title.charAt(0) === BRIDGE ? "" : document.title;
    document.title = BRIDGE + payload;
    setTimeout(() => {
      if (document.title.charAt(0) === BRIDGE) document.title = previous;
      bridgeQueue.shift();
      bridgePumping = false;
      setTimeout(pumpBridge, 40);
    }, 90);
  }

  function send(cmd, args, allowTitleFallback) {
    try {
      const internals = window.__TAURI_INTERNALS__;
      if (!internals || typeof internals.invoke !== "function") {
        if (allowTitleFallback) titleBridge(cmd, args);
        return;
      }
      Promise.resolve(internals.invoke(cmd, args)).catch(() => {
        if (allowTitleFallback) titleBridge(cmd, args);
      });
    } catch (error) {
      if (allowTitleFallback) titleBridge(cmd, args);
    }
  }

  function forwardNotification(title, options) {
    const opts = options && typeof options === "object" ? options : {};
    const body = opts.body == null ? "" : String(opts.body).slice(0, 500);
    send(
      "notify_from_service",
      { title: String(title || "Notification").slice(0, 200), body },
      true,
    );
  }

  function installNotification() {
    function RustboxNotification(title, options) {
      if (!new.target) {
        throw new TypeError("Failed to construct 'Notification': Please use the 'new' operator.");
      }
      const opts = options && typeof options === "object" ? options : {};
      forwardNotification(title, opts);
      this.title = String(title || "");
      this.body = opts.body == null ? "" : String(opts.body);
      this.icon = opts.icon == null ? "" : String(opts.icon);
      this.tag = opts.tag == null ? "" : String(opts.tag);
      this.data = opts.data;
      this.onclick = null;
      this.onclose = null;
      this.onerror = null;
      this.onshow = null;
      this.close = function close() {};
    }
    const native = window.Notification;
    RustboxNotification.prototype = native ? Object.create(native.prototype) : {};
    Object.defineProperty(RustboxNotification, "permission", {
      configurable: true,
      get: () => "granted",
    });
    RustboxNotification.requestPermission = function requestPermission(callback) {
      const result = Promise.resolve("granted");
      if (typeof callback === "function") result.then(callback);
      return result;
    };
    RustboxNotification.maxActions = native && native.maxActions ? native.maxActions : 2;
    try {
      Object.defineProperty(window, "Notification", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: RustboxNotification,
      });
    } catch (error) {
      window.Notification = RustboxNotification;
    }
    window.__rustboxNotification = RustboxNotification;

    const proto = window.ServiceWorkerRegistration && ServiceWorkerRegistration.prototype;
    if (proto && proto.showNotification !== window.__rustboxShowNotification) {
      function showNotification(title, options) {
        forwardNotification(title, options);
        return Promise.resolve();
      }
      window.__rustboxShowNotification = showNotification;
      try {
        proto.showNotification = showNotification;
      } catch (error) {
        /* The page replaced the prototype with a non-writable one. */
      }
    }
  }

  installNotification();

  function reportBadge(count) {
    const numeric = Number(count);
    const safe = Number.isFinite(numeric) && numeric > 0 ? Math.min(Math.floor(numeric), 999) : 0;
    send("set_badge", { count: safe }, false);
  }

  if (typeof navigator.setAppBadge === "function" && !navigator.setAppBadge.__rustbox) {
    const originalSet = navigator.setAppBadge.bind(navigator);
    const wrappedSet = function setAppBadge(count) {
      reportBadge(count == null ? 1 : count);
      try {
        return originalSet(count);
      } catch (error) {
        return Promise.resolve();
      }
    };
    wrappedSet.__rustbox = true;
    navigator.setAppBadge = wrappedSet;
  }
  if (typeof navigator.clearAppBadge === "function" && !navigator.clearAppBadge.__rustbox) {
    const originalClear = navigator.clearAppBadge.bind(navigator);
    const wrappedClear = function clearAppBadge() {
      reportBadge(0);
      try {
        return originalClear();
      } catch (error) {
        return Promise.resolve();
      }
    };
    wrappedClear.__rustbox = true;
    navigator.clearAppBadge = wrappedClear;
  }

  if (window.top === window) {
    setInterval(() => {
      if (window.Notification !== window.__rustboxNotification) installNotification();
    }, 2000);

    const onAnchorClick = (event) => {
      if (event.type === "click" && event.button !== 0) return;
      if (event.type === "auxclick" && event.button !== 1) return;
      const target = event.target;
      const anchor = target && target.closest ? target.closest("a[href]") : null;
      if (!anchor || !anchor.href) return;
      let url;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch (error) {
        return;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      // Same-site and sign-in navigations stay in the webview so logins work.
      // Everything else is an external link.
      if (isRelated(url) || isAuth(url)) return;
      event.preventDefault();
      event.stopPropagation();
      send("open_external_link", { url: url.toString() }, true);
    };
    document.addEventListener("click", onAnchorClick, true);
    document.addEventListener("auxclick", onAnchorClick, true);
  }
})();
