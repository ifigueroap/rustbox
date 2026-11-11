import { describe, expect, it } from "vitest";
import { moveAdjacent, reorderByDrop } from "../src/reorder";

describe("reorderByDrop", () => {
  it("inserts the dragged id right before the target by default", () => {
    expect(reorderByDrop(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("inserts after the target when placeAfter is set", () => {
    expect(reorderByDrop(["a", "b", "c"], "a", "b", true)).toEqual(["b", "a", "c"]);
  });

  it("is a no-op when the dragged id is the target", () => {
    expect(reorderByDrop(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
  });

  it("is a no-op when either id is unknown", () => {
    expect(reorderByDrop(["a", "b"], "z", "a")).toEqual(["a", "b"]);
    expect(reorderByDrop(["a", "b"], "a", "z")).toEqual(["a", "b"]);
  });

  it("keeps ids outside the pair in their relative order", () => {
    expect(reorderByDrop(["a", "x", "b", "y", "c"], "c", "a")).toEqual(["c", "a", "x", "b", "y"]);
  });

  it("returns a fresh array, not the input", () => {
    const input = ["a", "b"];
    const result = reorderByDrop(input, "b", "a");
    expect(result).not.toBe(input);
    expect(input).toEqual(["a", "b"]);
  });
});

describe("moveAdjacent", () => {
  it("swaps with the previous visible sibling when moving up", () => {
    expect(moveAdjacent(["a", "b", "c"], ["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
  });

  it("swaps with the next visible sibling when moving down", () => {
    expect(moveAdjacent(["a", "b", "c"], ["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
  });

  it("is a no-op at the top of the visible list", () => {
    expect(moveAdjacent(["a", "b", "c"], ["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op at the bottom of the visible list", () => {
    expect(moveAdjacent(["a", "b", "c"], ["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op when the id is not in the visible list", () => {
    expect(moveAdjacent(["a", "b", "c"], ["a", "b"], "c", -1)).toEqual(["a", "b", "c"]);
  });

  it("keeps a hidden id's relative position when moving up past it", () => {
    // x belongs to another workspace and sits between a and b in the full
    // order; moving b up (toward a) in the filtered view must not reorder x
    // relative to the ids that did not move.
    expect(moveAdjacent(["a", "x", "b", "c"], ["a", "b", "c"], "b", -1)).toEqual(["b", "a", "x", "c"]);
  });

  it("keeps a hidden id's relative position when moving down past it", () => {
    expect(moveAdjacent(["a", "b", "x", "c"], ["a", "b", "c"], "b", 1)).toEqual(["a", "x", "c", "b"]);
  });
});
