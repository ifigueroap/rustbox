import { beforeEach, expect, it } from "vitest";
import { scheduleEditor } from "../src/dnd-schedule";
import { setLocale } from "../src/i18n";

beforeEach(() => { setLocale("en"); document.body.replaceChildren(); });
it("edits enabled state, weekday chips, overnight times and removes rules", () => {
  const editor = scheduleEditor();
  document.body.append(editor.element);
  editor.element.querySelector<HTMLButtonElement>("button")!.click();
  const checkbox = editor.element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  checkbox.checked = true;
  const chips = editor.element.querySelectorAll<HTMLButtonElement>(".schedule-days button");
  expect(chips[0].getAttribute("aria-pressed")).toBe("true");
  chips[0].click();
  expect(editor.read()).toEqual({ enabled: true, rules: [{ days: ["tue", "wed", "thu", "fri"], startMinute: 1140, endMinute: 480 }] });
  const times = editor.element.querySelectorAll<HTMLInputElement>('input[type="time"]');
  times[0].value = "22:30";
  times[0].dispatchEvent(new Event("input"));
  expect(editor.read().rules[0].startMinute).toBe(1350);
  editor.element.querySelector<HTMLButtonElement>("fieldset > button")!.click();
  expect(editor.read().rules).toEqual([]);
});
it("rejects equal times and missing days without mutating its source", () => {
  const source = { enabled: true, rules: [{ days: ["mon"], startMinute: 60, endMinute: 120 }] };
  const editor = scheduleEditor(source);
  editor.element.querySelector<HTMLButtonElement>(".schedule-days button")!.click();
  expect(() => editor.read()).toThrow(/day/);
  expect(source.rules[0].days).toEqual(["mon"]);
  const invalid = scheduleEditor({ enabled: true, rules: [{ days: ["mon"], startMinute: 60, endMinute: 60 }] });
  expect(() => invalid.read()).toThrow(/different/);
});
it("localizes schedule labels and weekdays in Spanish", () => {
  setLocale("es");
  const editor = scheduleEditor({ enabled: true, rules: [{ days: ["sun"], startMinute: 1380, endMinute: 60 }] });
  expect(editor.element.textContent).toContain("Programar No molestar");
  expect(editor.element.textContent).toContain("Mié");
  expect(editor.element.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
});
