import { beforeEach, describe, expect, it } from "vitest";

import {
  applyDomTranslations,
  getLocale,
  resolveLocale,
  setLocale,
  t,
  translate,
} from "../src/i18n";
import { es } from "../src/i18n/es";
import { applyShellSnapshot, mountShell } from "../src/shell";
import { service, snapshot, workspace } from "./fixtures";
import { shellHtml } from "./html";

beforeEach(() => {
  setLocale("en");
});

describe("translate", () => {
  it("interpolates placeholders and picks a plural", () => {
    expect(t("count.servicesInWorkspace", { count: 7 })).toBe("7 services in this workspace");
    expect(t("count.servicesInWorkspace", { count: 1 })).toBe("1 service in this workspace");
    expect(t("sidebar.opening", { name: "Slack" })).toBe("Opening Slack");
    expect(t("sidebar.opening", {})).toBe("Opening {name}");
  });

  it("falls back to English when Spanish is missing a key", () => {
    const catalog = es as Record<string, unknown>;
    const saved = catalog["settings.language"];
    delete catalog["settings.language"];
    try {
      expect(translate("es", "settings.language")).toBe("Language");
      expect(translate("es", "not.a.real.key")).toBe("not.a.real.key");
    } finally {
      catalog["settings.language"] = saved;
    }
  });

  it("maps es-* to Spanish and every other tag to English", () => {
    expect(resolveLocale("system", "es-CL", "en")).toBe("es");
    expect(resolveLocale("system", "es", "en")).toBe("es");
    expect(resolveLocale("system", "en-US", "es")).toBe("en");
    expect(resolveLocale("system", "fr-FR", "es")).toBe("en");
    expect(resolveLocale("system", "", "es")).toBe("es");
    expect(resolveLocale("system", undefined, "es")).toBe("es");
    expect(resolveLocale("es", "en-US", "en")).toBe("es");
    expect(resolveLocale("en", "es-CL", "es")).toBe("en");
  });
});

describe("shell language", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = shellHtml();
    mountShell();
  });

  it("applies Spanish immediately, including plurals and the language select", () => {
    const main = workspace("Main", { order: 0, serviceCount: 7 });
    const services = Array.from({ length: 7 }, (_, index) => service(`S${index}`, [main.id]));
    applyShellSnapshot(
      snapshot({
        language: "es",
        osLocale: "en",
        workspaces: [main],
        services,
        activeWorkspaceId: main.id,
      }),
    );

    expect(getLocale()).toBe("es");
    expect(document.documentElement.lang).toBe("es");
    expect(document.querySelector("#language-select")).toBeInstanceOf(HTMLSelectElement);
    expect((document.querySelector("#language-select") as HTMLSelectElement).value).toBe("es");
    expect(document.querySelector(".dnd-label")?.textContent).toBe("No molestar");
    expect(document.querySelector("#dash-workspace-add")?.textContent).toBe("Nuevo espacio de trabajo");
    expect(document.querySelector("#check-updates")?.textContent).toBe("Buscar ahora");
    expect(document.querySelector("#dash-lede")?.textContent).toContain(
      "7 servicios en este espacio de trabajo",
    );
    expect(document.querySelector("#settings-language, #language-select")).not.toBeNull();
    const card = document.querySelector(".card-actions button");
    expect(card?.textContent).toBe("Abrir");
    expect(document.querySelector(".unread-pill")?.textContent).toBe("Nada sin leer");
  });

  it("keeps English when the preference is system and the webview is not Spanish", () => {
    Object.defineProperty(window.navigator, "language", { value: "en-US", configurable: true });
    const main = workspace("Main", { order: 0 });
    applyShellSnapshot(snapshot({ language: "system", osLocale: "es", workspaces: [main], services: [] }));
    expect(document.querySelector(".dnd-label")?.textContent).toBe("Do not disturb");
    applyDomTranslations();
    expect(document.querySelector("#check-updates")?.textContent).toBe("Check now");
  });
});
