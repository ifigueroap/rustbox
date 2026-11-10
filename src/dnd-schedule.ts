import { t } from "./i18n";
export const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export interface Schedule { enabled: boolean; rules: { days: string[]; startMinute: number; endMinute: number }[] }
export function scheduleEditor(value: Schedule = { enabled: false, rules: [] }): { element: HTMLElement; read: () => Schedule } {
  const schedule = structuredClone(value);
  const element = document.createElement("details");
  element.className = "schedule-editor";
  const title = document.createElement("summary");
  title.dataset.i18n = "schedule.title";
  title.textContent = t("schedule.title");
  const hint = document.createElement("p");
  hint.className = "field-hint";
  hint.dataset.i18n = "schedule.hint";
  hint.textContent = t("schedule.hint");
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = schedule.enabled;
  const label = document.createElement("label");
  label.className = "check";
  const enabledText = document.createElement("span");
  enabledText.dataset.i18n = "schedule.enabled";
  enabledText.textContent = t("schedule.enabled");
  label.append(enabled, enabledText);
  const rows = document.createElement("div");
  const paint = () => {
    rows.replaceChildren();
    schedule.rules.forEach((rule, index) => {
      const row = document.createElement("fieldset");
      const chips = document.createElement("div");
      chips.className = "schedule-days";
      days.forEach(day => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.dataset.i18n = `schedule.${day}`;
        chip.textContent = t(`schedule.${day}`);
        chip.setAttribute("aria-pressed", String(rule.days.includes(day)));
        chip.onclick = () => { rule.days = rule.days.includes(day) ? rule.days.filter(d => d !== day) : [...rule.days, day]; paint(); };
        chips.append(chip);
      });
      row.append(chips);
      (["startMinute", "endMinute"] as const).forEach((key, i) => {
        const label = document.createElement("label");
        const text = document.createElement("span");
        text.dataset.i18n = i ? "schedule.end" : "schedule.start";
        text.textContent = t(i ? "schedule.end" : "schedule.start");
        label.append(text);
        const input = document.createElement("input");
        input.type = "time";
        input.required = true;
        input.value = `${String(Math.floor(rule[key] / 60)).padStart(2, "0")}:${String(rule[key] % 60).padStart(2, "0")}`;
        input.oninput = () => { const [h, m] = input.value.split(":").map(Number); rule[key] = h * 60 + m; };
        label.append(input);
        row.append(label);
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.i18n = "common.remove";
      remove.textContent = t("common.remove");
      remove.onclick = () => { schedule.rules.splice(index, 1); paint(); };
      row.append(remove);
      rows.append(row);
    });
  };
  const add = document.createElement("button");
  add.type = "button";
  add.dataset.i18n = "schedule.add";
  add.textContent = t("schedule.add");
  add.onclick = () => { if (schedule.rules.length < 20) schedule.rules.push({ days: [...days.slice(0, 5)], startMinute: 1140, endMinute: 480 }); paint(); };
  element.append(title, hint, label, rows, add);
  paint();
  return { element, read: () => {
    if (schedule.rules.some(r => !r.days.length || !Number.isFinite(r.startMinute) || !Number.isFinite(r.endMinute) || r.startMinute === r.endMinute)) throw new Error(t("schedule.invalid"));
    return { ...schedule, enabled: enabled.checked };
  } };
}
