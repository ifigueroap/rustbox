let counter = 0;

function id(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export interface TestService {
  id: string;
  name: string;
  url: string;
  icon?: string | null;
  workspaceIcon?: string | null;
  color: string;
  userAgent?: string | null;
  useChromeUserAgent: boolean;
  preset?: string | null;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  workspaces: string[];
  allWorkspaces: boolean;
  workspaceSilenced: boolean;
  rawUnread: number;
  unread: number;
}

export interface TestWorkspace {
  id: string;
  name: string;
  icon?: string | null;
  color: string;
  dnd: boolean;
  order: number;
  unread: number;
  rawUnread: number;
  serviceCount: number;
}

export interface TestSnapshot {
  services: TestService[];
  workspaces: TestWorkspace[];
  activeWorkspaceId: string | null;
  activeId: string | null;
  lastServiceId: string | null;
  chromeUserAgent: string;
  configPath: string;
  sessionsDir: string;
  sidebarCollapsed: boolean;
  workspaceRailHidden: boolean;
  doNotDisturb: boolean;
  closeToTray: boolean;
  trayAvailable: boolean;
  theme: "auto" | "light" | "dark";
  appVersion: string;
}

export function workspace(name: string, overrides: Partial<TestWorkspace> = {}): TestWorkspace {
  return {
    id: id("ws"),
    name,
    icon: null,
    color: "#8d8478",
    dnd: false,
    order: 0,
    unread: 0,
    rawUnread: 0,
    serviceCount: 0,
    ...overrides,
  };
}

export function service(
  name: string,
  workspaceIds: string[],
  overrides: Partial<TestService> = {},
): TestService {
  return {
    id: id("svc"),
    name,
    url: "https://example.com/",
    icon: null,
    workspaceIcon: null,
    color: "#8d8478",
    userAgent: null,
    useChromeUserAgent: true,
    preset: null,
    soundEnabled: true,
    notificationsEnabled: true,
    workspaces: workspaceIds,
    allWorkspaces: false,
    workspaceSilenced: false,
    rawUnread: 0,
    unread: 0,
    ...overrides,
  };
}

export function snapshot(overrides: Partial<TestSnapshot> = {}): TestSnapshot {
  const main = workspace("Main", { order: 0 });
  const items = overrides.services ?? [service("Slack", [main.id], { preset: "slack" })];
  const list = overrides.workspaces ?? [main];
  return {
    services: items,
    workspaces: list.map((item, index) => ({
      ...item,
      order: index,
      serviceCount: items.filter(
        (entry) => entry.allWorkspaces || entry.workspaces.includes(item.id),
      ).length,
    })),
    activeWorkspaceId: list[0]?.id ?? null,
    activeId: null,
    lastServiceId: null,
    chromeUserAgent: "Chrome/155",
    configPath: "/tmp/config.json",
    sessionsDir: "/tmp/sessions",
    sidebarCollapsed: false,
    workspaceRailHidden: false,
    doNotDisturb: false,
    closeToTray: true,
    trayAvailable: true,
    theme: "dark",
    appVersion: "0.5.0",
    ...overrides,
  };
}
