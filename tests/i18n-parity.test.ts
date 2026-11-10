import { expect, it } from "vitest";

import { en } from "../src/i18n/en";
import { es } from "../src/i18n/es";

it("provides the same English and Spanish keys and plural forms", () => {
  expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    expect(typeof es[key], key).toBe(typeof en[key]);
    if (typeof en[key] === "object") {
      expect(Object.keys(es[key]).sort(), key).toEqual(Object.keys(en[key]).sort());
    }
  }
});
