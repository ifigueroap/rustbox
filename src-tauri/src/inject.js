// Injected into every service webview before page scripts run.
// Link decisions mirror src-tauri/src/policy.rs. Keep the suffix lists in sync;
// policy tests fail if a suffix is missing here.
(() => {
  if (window.__rustbox) return;
  window.__rustbox = true;

  const AUTH = [
    "google.com",
    "googleusercontent.com",
    "gstatic.com",
    "microsoftonline.com",
    "microsoft.com",
    "live.com",
    "office.com",
    "office365.com",
    "windows.net",
    "apple.com",
    "icloud.com",
    "facebook.com",
    "fb.com",
    "facebook.net",
    "okta.com",
    "okta-emea.com",
    "auth0.com",
    "github.com",
    "amazonaws.com",
    "onelogin.com",
    "duosecurity.com",
    "pingidentity.com",
    "atlassian.net",
    "atlassian.com",
  ];

  const MULTI = [
    "co.uk",
    "org.uk",
    "ac.uk",
    "com.au",
    "net.au",
    "co.jp",
    "com.br",
    "co.nz",
    "com.mx",
    "co.in",
    "com.ar",
    "co.za",
    "com.tr",
    "co.kr",
  ];

  function invoke(command, args) {
    const internals = window.__TAURI_INTERNALS__;
    if (!internals || typeof internals.invoke !== "function") return;
    Promise.resolve(internals.invoke(command, args)).catch(() => {});
  }

  function registrable(host) {
    const parts = String(host || "")
      .toLowerCase()
      .replace(/\.$/, "")
      .split(".")
      .filter(Boolean);
    if (parts.length <= 2) return parts.join(".");
    const lastTwo = parts.slice(-2).join(".");
    if (MULTI.indexOf(lastTwo) !== -1 && parts.length >= 3) {
      return parts.slice(-3).join(".");
    }
    return lastTwo;
  }

  function matchesSuffix(host, suffix) {
    return host === suffix || host.endsWith("." + suffix);
  }

  function isAuth(host) {
    const normalized = String(host || "").toLowerCase().replace(/\.$/, "");
    return AUTH.some((suffix) => matchesSuffix(normalized, suffix));
  }

  function sameSite(left, right) {
    const a = registrable(left);
    const b = registrable(right);
    return a.length > 0 && a === b;
  }

  function openExternal(url) {
    invoke("open_external", { url: String(url) });
  }

  function onAnchorClick(event) {
    if (event.defaultPrevented) return;
    const source = event.target;
    if (!source || typeof source.closest !== "function") return;
    const anchor = source.closest("a[href]");
    if (!anchor) return;

    let url;
    try {
      url = new URL(anchor.href, window.location.href);
    } catch (_error) {
      return;
    }

    const scheme = url.protocol.replace(/:$/, "");
    if (scheme !== "http" && scheme !== "https" && scheme !== "mailto" && scheme !== "tel") {
      return;
    }

    const sameService = sameSite(window.location.hostname, url.hostname);
    if (sameService && anchor.target === "_blank") {
      anchor.target = "_self";
    }

    const newWindow =
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button === 1 ||
      anchor.target === "_blank";

    if (
      scheme === "mailto" ||
      scheme === "tel" ||
      (newWindow && !sameService && !isAuth(url.hostname))
    ) {
      event.preventDefault();
      event.stopPropagation();
      openExternal(url.toString());
      return;
    }

    if (!newWindow && !sameService && !isAuth(url.hostname)) {
      event.preventDefault();
      event.stopPropagation();
      openExternal(url.toString());
    }
  }

  document.addEventListener("click", onAnchorClick, true);
  document.addEventListener("auxclick", onAnchorClick, true);

  function isServiceShortcut(event) {
    if (event.repeat || event.altKey || !(event.ctrlKey || event.metaKey)) return false;
    if (event.key === "Tab") return true;
    if (!event.shiftKey && /^[1-9]$/.test(event.key)) return true;
    return event.shiftKey && String(event.key).toLowerCase() === "d";
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (!isServiceShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      invoke("apply_service_shortcut", {
        key: event.key,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        shift: event.shiftKey,
        alt: event.altKey,
      });
    },
    true,
  );

  function RustboxNotification(title, options) {
    if (!(this instanceof RustboxNotification)) {
      return new RustboxNotification(title, options);
    }
    const opts = options && typeof options === "object" ? options : {};
    this.title = title == null ? "" : String(title);
    this.body = opts.body == null ? "" : String(opts.body);
    this.icon = opts.icon == null ? "" : String(opts.icon);
    this.tag = opts.tag == null ? "" : String(opts.tag);
    this.data = opts.data;
    this.onclick = null;
    this.onclose = null;
    this.onerror = null;
    this.onshow = null;
    this.close = function close() {};
    const self = this;
    setTimeout(() => {
      invoke("forward_notification", {
        title: self.title.slice(0, 180),
        body: self.body.slice(0, 500),
      });
      if (typeof self.onshow === "function") {
        try {
          self.onshow();
        } catch (_error) {
          /* The page's handler is not our problem. */
        }
      }
    }, 0);
  }

  RustboxNotification.permission = "granted";
  RustboxNotification.maxActions = 0;
  RustboxNotification.requestPermission = function requestPermission(callback) {
    const result = Promise.resolve("granted");
    if (typeof callback === "function") result.then(callback);
    return result;
  };

  try {
    if (window.Notification && window.Notification.prototype) {
      RustboxNotification.prototype = Object.create(window.Notification.prototype);
      RustboxNotification.prototype.constructor = RustboxNotification;
    }
  } catch (_error) {
    /* A frozen Notification constructor still gets replaced below when possible. */
  }

  try {
    window.Notification = RustboxNotification;
  } catch (_error) {
    /* Some origins seal the constructor. Title badges still work from Rust. */
  }

  try {
    if (navigator.permissions && typeof navigator.permissions.query === "function") {
      const query = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function queryPermission(descriptor) {
        if (descriptor && descriptor.name === "notifications") {
          return Promise.resolve({ state: "granted", onchange: null });
        }
        return query(descriptor);
      };
    }
  } catch (_error) {
    /* Permission queries are optional. */
  }

  const mediaTouched = new WeakMap();
  const contexts = new Set();
  let soundOn = true;

  function muteElement(element) {
    if (!mediaTouched.has(element)) mediaTouched.set(element, element.muted);
    element.muted = true;
  }

  function unmuteElement(element) {
    if (!mediaTouched.has(element)) return;
    element.muted = mediaTouched.get(element);
    mediaTouched.delete(element);
  }

  function eachMedia(root, visit) {
    if (!root) return;
    if (root.nodeType === 1 && root.matches && root.matches("audio, video")) visit(root);
    if (root.querySelectorAll) root.querySelectorAll("audio, video").forEach(visit);
  }

  function applySound(enabled) {
    soundOn = !!enabled;
    eachMedia(document, soundOn ? unmuteElement : muteElement);
    contexts.forEach((ctx) => {
      if (!ctx || ctx.state === "closed") return;
      if (soundOn) {
        if (ctx.__rustboxSuspended) {
          ctx.__rustboxSuspended = false;
          ctx.resume();
        }
      } else if (ctx.state === "running") {
        ctx.__rustboxSuspended = true;
        ctx.suspend();
      }
    });
  }

  window.__rustboxSetSound = applySound;

  function watchMedia(root) {
    if (!root || typeof MutationObserver !== "function") return;
    const observer = new MutationObserver((records) => {
      if (soundOn) return;
      records.forEach((record) => {
        record.addedNodes.forEach((node) => eachMedia(node, muteElement));
      });
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  if (document.documentElement) watchMedia(document.documentElement);
  else document.addEventListener("DOMContentLoaded", () => watchMedia(document.documentElement));

  if (window.HTMLMediaElement && window.HTMLMediaElement.prototype) {
    const play = window.HTMLMediaElement.prototype.play;
    window.HTMLMediaElement.prototype.play = function rustboxPlay() {
      if (!soundOn) muteElement(this);
      return play.apply(this, arguments);
    };
  }

  if (typeof window.Audio === "function") {
    const NativeAudio = window.Audio;
    window.Audio = function RustboxAudio() {
      const element = new NativeAudio(...arguments);
      if (!soundOn) muteElement(element);
      return element;
    };
  }

  function wrapContext(name) {
    const Native = window[name];
    if (typeof Native !== "function" || Native.__rustbox) return;
    function Wrapped() {
      const ctx = new Native(...arguments);
      contexts.add(ctx);
      const resume = ctx.resume.bind(ctx);
      ctx.resume = function rustboxResume() {
        if (!soundOn) {
          ctx.__rustboxSuspended = true;
          return Promise.resolve();
        }
        return resume.apply(ctx, arguments);
      };
      if (!soundOn && ctx.state !== "closed") {
        ctx.__rustboxSuspended = true;
        ctx.suspend();
      }
      return ctx;
    }
    Wrapped.prototype = Native.prototype;
    Wrapped.__rustbox = true;
    window[name] = Wrapped;
  }

  wrapContext("AudioContext");
  wrapContext("webkitAudioContext");
})();
