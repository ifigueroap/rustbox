import { en } from "./en";
import { es } from "./es";

export type Locale = "en" | "es";
export type LanguagePreference = "system" | Locale;
export type MessageKey = keyof typeof en;
export type Vars = Record<string, string | number>;

type Message = string | { one: string; other: string };

const catalogs: Record<Locale, Record<string, Message>> = { en, es };

let current: Locale = "en";

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale;
}

/** `es` and `es-*` map to Spanish. Every other tag maps to English. */
export function localeFromTag(tag: string | null | undefined): Locale {
  const primary = tag?.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return primary === "es" ? "es" : "en";
}

/**
 * A saved `en` or `es` wins. `system` uses the webview language when it is
 * set, and the OS locale reported by Rust otherwise.
 */
export function resolveLocale(
  preference: LanguagePreference,
  navigatorLanguage: string | null | undefined,
  osLocale: Locale,
): Locale {
  if (preference === "en" || preference === "es") return preference;
  const tag = navigatorLanguage?.trim();
  if (tag) return localeFromTag(tag);
  return osLocale;
}

/** BCP 47 tag for `Intl`. Spanish uses the Latin American locale. */
export function intlTag(locale: Locale = current): string {
  return locale === "es" ? "es-419" : "en";
}

function interpolate(template: string, vars: Vars): string {
  return template.replace(/\{(\w+)\}/g, (token, name: string) => {
    const value = vars[name];
    return value === undefined ? token : String(value);
  });
}

function pluralForm(message: { one: string; other: string }, vars: Vars): string {
  const raw = vars.count;
  const count = typeof raw === "number" ? raw : Number(raw);
  return interpolate(count === 1 ? message.one : message.other, vars);
}

/** Look up `key` in `locale`, then in English, then return the key itself. */
export function translate(locale: Locale, key: string, vars: Vars = {}): string {
  const message = catalogs[locale]?.[key] ?? catalogs.en[key];
  if (message === undefined) return key;
  if (typeof message === "string") return interpolate(message, vars);
  return pluralForm(message, vars);
}

export function t(key: MessageKey, vars?: Vars): string {
  return translate(current, key, vars);
}

export function isMessageKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

const ATTRIBUTE_BINDINGS: Array<[attribute: string, dataset: string, assign: (node: HTMLElement, text: string) => void]> = [
  ["data-i18n", "i18n", (node, text) => {
    node.textContent = text;
  }],
  ["data-i18n-title", "i18nTitle", (node, text) => {
    node.title = text;
  }],
  ["data-i18n-aria", "i18nAria", (node, text) => {
    node.setAttribute("aria-label", text);
  }],
  ["data-i18n-placeholder", "i18nPlaceholder", (node, text) => {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      node.placeholder = text;
    }
  }],
];

/** Fill every element that declares a catalog key. Dynamic copy is painted by the shell. */
export function applyDomTranslations(root: ParentNode = document): void {
  for (const [attribute, dataset, assign] of ATTRIBUTE_BINDINGS) {
    root.querySelectorAll<HTMLElement>(`[${attribute}]`).forEach((node) => {
      const key = node.dataset[dataset];
      if (!key) return;
      assign(node, isMessageKey(key) ? t(key) : translate(current, key));
    });
  }
}
