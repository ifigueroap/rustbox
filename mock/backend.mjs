// A browser stand-in for the Tauri backend, used to drive the shell for the
// visual verification. It implements just enough of the command surface that
// src/shell.ts uses, and keeps the same shapes the Rust side serializes.
//
// The shell module is imported dynamically, after the fake IPC bridge below is
// installed: a static import would run the module body (and its boot check)
// before `__TAURI_INTERNALS__` exists.

const DEFAULT_COLOR = "#8d8478";

let counter = 0;
const nextId = (prefix) => `${prefix}-${(counter += 1)}`;

function presetList() {
  return [
    { id: "whatsapp", name: "WhatsApp", url: "https://web.whatsapp.com/", color: "#25D366", requiresServerUrl: false, urlHint: "" },
    { id: "slack", name: "Slack", url: "https://app.slack.com/", color: "#4A154B", requiresServerUrl: false, urlHint: "" },
    { id: "discord", name: "Discord", url: "https://discord.com/app", color: "#5865F2", requiresServerUrl: false, urlHint: "" },
    { id: "zulip", name: "Zulip", url: null, color: "#3AA88A", requiresServerUrl: true, urlHint: "https://your-org.zulipchat.com" },
    { id: "telegram", name: "Telegram", url: "https://web.telegram.org/a/", color: "#2AABEE", requiresServerUrl: false, urlHint: "" },
    { id: "grok", name: "Grok", url: "https://grok.com/", color: "#111111", requiresServerUrl: false, urlHint: "" },
    { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", color: "#10A37F", requiresServerUrl: false, urlHint: "" },
    { id: "claude", name: "Claude", url: "https://claude.ai/", color: "#D97757", requiresServerUrl: false, urlHint: "" },
  ];
}

function makeWorkspace(name, order) {
  return { id: nextId("ws"), name, icon: null, color: "#8d8478", dnd: false, order, unread: 0, rawUnread: 0, serviceCount: 0 };
}

function makeService(name, preset, workspaceIds, extra = {}) {
  const presetInfo = presetList().find((item) => item.id === preset);
  return {
    id: nextId("svc"),
    name,
    url: presetInfo?.url ?? "https://example.com/",
    icon: null,
    workspaceIcon: null,
    color: presetInfo?.color ?? DEFAULT_COLOR,
    userAgent: null,
    useChromeUserAgent: true,
    preset,
    soundEnabled: true,
    notificationsEnabled: true,
    workspaces: workspaceIds,
    allWorkspaces: false,
    workspaceSilenced: false,
    rawUnread: 0,
    unread: 0,
    ...extra,
  };
}

const main = makeWorkspace("Main", 0);
const state = {
  services: [
    makeService("WhatsApp", "whatsapp", [main.id]),
    makeService("Slack", "slack", [main.id]),
    makeService("Discord", "discord", [main.id]),
    makeService("Grok", "grok", [main.id]),
    makeService("Claude", "claude", [main.id]),
  ],
  workspaces: [main],
  activeWorkspaceId: main.id,
  activeId: null,
  lastServiceId: null,
  sidebarCollapsed: false,
  workspaceRailHidden: false,
  doNotDisturb: false,
  closeToTray: true,
  trayAvailable: true,
  theme: "auto",
  language: "system",
  osLocale: "en",
  appVersion: "0.5.0",
  update: {
    state: "idle",
    current: "0.5.0",
    latest: null,
    notes: null,
    url: null,
    canInstall: true,
    autoCheck: true,
    lastCheckedAt: null,
  },
};

function recompute() {
  state.workspaces.sort((left, right) => left.order - right.order);
  state.workspaces.forEach((workspace, index) => {
    workspace.order = index;
    workspace.serviceCount = state.services.filter(
      (service) => service.allWorkspaces || service.workspaces.includes(workspace.id),
    ).length;
  });
}

function snapshot() {
  recompute();
  return {
    ...state,
    services: state.services.map((service) => ({ ...service })),
    workspaces: state.workspaces.map((workspace) => ({ ...workspace })),
    chromeUserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
    configPath: "C:\\Users\\Ismael\\AppData\\Roaming\\app.rustbox.desktop\\config.json",
    sessionsDir: "C:\\Users\\Ismael\\AppData\\Roaming\\app.rustbox.desktop\\sessions",
  };
}

window.__TAURI_INTERNALS__ = {
  transformCallback() {
    return 1;
  },
  invoke(command, args = {}) {
    switch (command) {
      case "plugin:event|listen":
        return Promise.resolve(1);
      case "list_presets":
        return Promise.resolve(presetList());
      case "get_state":
        return Promise.resolve(snapshot());
      case "add_workspace": {
        const created = makeWorkspace(args.workspace.name, state.workspaces.length);
        created.icon = args.workspace.icon ?? null;
        created.color = args.workspace.color ?? DEFAULT_COLOR;
        state.workspaces.push(created);
        for (const id of args.workspace.includeServices ?? []) {
          const service = state.services.find((item) => item.id === id);
          if (service && !service.allWorkspaces && !service.workspaces.includes(created.id)) {
            service.workspaces.push(created.id);
          }
        }
        state.activeWorkspaceId = created.id;
        state.activeId = null;
        return Promise.resolve(snapshot());
      }
      case "update_workspace": {
        const workspace = state.workspaces.find((item) => item.id === args.workspace.id);
        if (workspace) {
          workspace.name = args.workspace.name;
          workspace.icon = args.workspace.icon;
          workspace.color = args.workspace.color;
        }
        return Promise.resolve(snapshot());
      }
      case "include_services": {
        for (const id of args.serviceIds) {
          const service = state.services.find((item) => item.id === id);
          if (service && !service.allWorkspaces && !service.workspaces.includes(args.workspaceId)) {
            service.workspaces.push(args.workspaceId);
          }
        }
        return Promise.resolve(snapshot());
      }
      case "set_active_workspace":
        state.activeWorkspaceId = args.id;
        state.activeId = null;
        return Promise.resolve(snapshot());
      case "set_active_service":
        state.activeId = args.id ?? null;
        return Promise.resolve(snapshot());
      case "remove_workspace": {
        const index = state.workspaces.findIndex((item) => item.id === args.id);
        if (index < 0 || state.workspaces.length <= 1) {
          return Promise.reject("keep at least one workspace");
        }
        state.workspaces.splice(index, 1);
        const fallback = state.workspaces[0].id;
        for (const service of state.services) {
          service.workspaces = service.workspaces.filter((id) => id !== args.id);
          if (!service.allWorkspaces && service.workspaces.length === 0) {
            service.workspaces.push(fallback);
          }
        }
        if (state.activeWorkspaceId === args.id) state.activeWorkspaceId = fallback;
        return Promise.resolve(snapshot());
      }
      case "set_workspace_rail_hidden":
        state.workspaceRailHidden = args.hidden;
        return Promise.resolve(snapshot());
      case "set_sidebar_collapsed":
        state.sidebarCollapsed = args.collapsed;
        return Promise.resolve(snapshot());
      case "set_theme":
        state.theme = args.theme;
        return Promise.resolve(snapshot());
      case "set_do_not_disturb":
        state.doNotDisturb = args.enabled;
        return Promise.resolve(snapshot());
      case "set_workspace_dnd": {
        const workspace = state.workspaces.find((item) => item.id === args.id);
        if (workspace) workspace.dnd = args.enabled;
        return Promise.resolve(snapshot());
      }
      case "move_workspace": {
        const index = state.workspaces.findIndex((item) => item.id === args.id);
        const target = index + args.delta;
        if (index >= 0 && target >= 0 && target < state.workspaces.length) {
          const [moved] = state.workspaces.splice(index, 1);
          state.workspaces.splice(target, 0, moved);
        }
        return Promise.resolve(snapshot());
      }
      case "reorder_workspaces": {
        state.workspaces = args.ids.map((id) => state.workspaces.find((item) => item.id === id));
        return Promise.resolve(snapshot());
      }
      case "reorder_services": {
        state.services = args.ids.map((id) => state.services.find((item) => item.id === id));
        return Promise.resolve(snapshot());
      }
      case "update_service": {
        const service = state.services.find((item) => item.id === args.service.id);
        if (service) Object.assign(service, args.service);
        return Promise.resolve(snapshot());
      }
      case "remove_service":
        state.services = state.services.filter((item) => item.id !== args.id);
        if (state.activeId === args.id) state.activeId = null;
        return Promise.resolve(snapshot());
      case "add_preset": {
        const preset = presetList().find((item) => item.id === args.presetId);
        state.services.push(
          makeService(preset.name, preset.id, [state.activeWorkspaceId ?? state.workspaces[0].id]),
        );
        return Promise.resolve(snapshot());
      }
      case "add_custom": {
        state.services.push({
          ...makeService(args.service.name, null, args.service.workspaces, {
            url: args.service.url,
            allWorkspaces: args.service.allWorkspaces,
          }),
        });
        return Promise.resolve(snapshot());
      }
      case "reload_service":
      case "open_external":
      case "quit_app":
      case "set_service_sound":
      case "set_service_notifications":
      case "relaunch_app":
      case "set_ui_locale":
        return Promise.resolve(snapshot());
      case "set_close_to_tray":
        state.closeToTray = Boolean(args.enabled);
        return Promise.resolve(snapshot());
      case "set_language":
        state.language = args.language;
        return Promise.resolve(snapshot());
      case "set_update_auto_check":
        state.update.autoCheck = args.enabled;
        return Promise.resolve(snapshot());
      case "check_for_updates":
        state.update = {
          ...state.update,
          state: "available",
          latest: "0.9.0",
          notes: "A quieter tray and a signed update.",
          url: "https://github.com/ifigueroap/rustbox/releases/tag/v0.9.0",
          canInstall: true,
          lastCheckedAt: "2026-10-29T01:00:00Z",
        };
        return Promise.resolve(state.update);
      case "skip_update":
        state.update = { ...state.update, state: "idle", notes: null, url: null };
        return Promise.resolve(snapshot());
      case "install_update":
        return Promise.resolve(null);
      case "apply_service_shortcut":
        return Promise.resolve(snapshot());
      default:
        return Promise.reject(`no mock for ${command}`);
    }
  },
};

// Import the shell only now that the fake bridge exists, so its boot path runs
// against the mock instead of failing the "open this from the app" check.
const shell = await import("/src/shell.ts");
window.__rustboxMock = { state, snapshot, shell };
await shell.renderShell();
