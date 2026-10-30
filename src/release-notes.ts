import DOMPurify from "dompurify";
import { Marked } from "marked";

import { intlTag } from "./i18n";

const ALLOWED_TAGS = [
  "a",
  "br",
  "code",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "ul",
];

/** Release Please appends `([abc1234](.../commit/abc1234))` after the PR link. */
const COMMIT_LINK =
  /\s*\(\[[0-9a-f]{7,40}\]\(https?:\/\/[^)\s]+\/commit\/[0-9a-f]{7,64}\)\)/gi;

const TRAILING_DATE = /\((\d{4}-\d{2}-\d{2})\)\s*$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Absolute http(s) URL, or null when the value must not be opened or linked. */
export function httpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const href = raw.trim();
  if (!href || /[\u0000-\u001F\u007F]/.test(href)) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.href;
}

function stripCommitLinks(markdown: string): string {
  return markdown.replace(COMMIT_LINK, "");
}

const notesParser = new Marked({
  async: false,
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    checkbox() {
      return "";
    },
    link({ href, tokens }) {
      const inner = this.parser.parseInline(tokens);
      const safe = httpUrl(href);
      if (!safe) return inner;
      return `<a href="${escapeHtml(safe)}">${inner}</a>`;
    },
    image({ text }) {
      return escapeHtml(text);
    },
  },
});

function sanitizeNotes(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
  });
}

function releaseDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

function formatReleaseDate(date: Date): string {
  return new Intl.DateTimeFormat(intlTag(), {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

/** Turn a trailing `(YYYY-MM-DD)` on a heading into a quiet localized date. */
function decorateReleaseDates(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const heading of template.content.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const node = [...heading.childNodes].reverse().find((child) => child.nodeType === Node.TEXT_NODE);
    if (!node?.textContent) continue;
    const match = TRAILING_DATE.exec(node.textContent);
    if (!match?.[1]) continue;
    const date = releaseDate(match[1]);
    if (!date) continue;
    const time = document.createElement("time");
    time.className = "release-date";
    time.dateTime = match[1];
    time.textContent = formatReleaseDate(date);
    const before = node.textContent.slice(0, match.index).replace(/\s+$/, "");
    if (before) {
      node.textContent = `${before} `;
      node.after(time);
    } else {
      node.replaceWith(time);
    }
  }
  return template.innerHTML;
}

/**
 * Changelog markdown from `latest.json`, as HTML safe to assign to the shell.
 * Raw HTML is escaped, and the only links kept are absolute http(s) URLs.
 */
export function renderReleaseNotes(markdown: string): string {
  const parsed = notesParser.parse(stripCommitLinks(markdown));
  if (typeof parsed !== "string") return "";
  return decorateReleaseDates(sanitizeNotes(parsed));
}
