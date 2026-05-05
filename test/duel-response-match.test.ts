import { describe, expect, it } from "vitest";
import { duelActionMatchesSelector } from "#duel/action-selectors.js";
import { sameAction } from "#duel/response-match.js";
import type { DuelAction } from "#duel/types.js";

describe("duel response matching", () => {
  it("matches unordered summon material responses without accepting duplicates", () => {
    const action: DuelAction = {
      type: "fusionSummon",
      player: 0,
      uid: "fusion",
      materialUids: ["mat-a", "mat-b"],
      label: "Fusion",
      windowId: 1,
      windowKind: "open",
    };

    expect(sameAction(action, { ...action, materialUids: ["mat-b", "mat-a"] })).toBe(true);
    expect(sameAction(action, { ...action, materialUids: ["mat-a", "mat-a"] })).toBe(false);
  });

  it("matches unordered fixture material selectors without accepting duplicates", () => {
    const action: DuelAction = {
      type: "xyzSummon",
      player: 0,
      uid: "xyz",
      materialUids: ["mat-a", "mat-b"],
      label: "Xyz",
      windowId: 2,
      windowKind: "open",
    };

    expect(duelActionMatchesSelector(action, { type: "xyzSummon", player: 0, materialUids: ["mat-b", "mat-a"] }, [])).toBe(true);
    expect(duelActionMatchesSelector(action, { type: "xyzSummon", player: 0, materialUids: ["mat-a", "mat-a"] }, [])).toBe(false);
  });
});
