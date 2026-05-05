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

  it("matches explicit direct attack responses only to direct attack actions", () => {
    const direct: DuelAction = { type: "declareAttack", player: 0, attackerUid: "attacker", directAttack: true, label: "Direct", windowId: 3, windowKind: "open" };
    const targeted: DuelAction = { type: "declareAttack", player: 0, attackerUid: "attacker", targetUid: "target", label: "Target", windowId: 3, windowKind: "open" };

    expect(sameAction(direct, { ...direct, directAttack: true })).toBe(true);
    expect(sameAction(targeted, { type: "declareAttack", player: 0, attackerUid: "attacker", directAttack: true, label: "Direct", windowId: 3, windowKind: "open" })).toBe(false);
  });

  it("matches explicit direct replay responses only to direct replay actions", () => {
    const direct: DuelAction = { type: "replayAttack", player: 0, attackerUid: "attacker", directAttack: true, label: "Direct replay", windowId: 4, windowKind: "battle" };
    const targeted: DuelAction = { type: "replayAttack", player: 0, attackerUid: "attacker", targetUid: "target", label: "Replay target", windowId: 4, windowKind: "battle" };

    expect(sameAction(direct, { ...direct, directAttack: true })).toBe(true);
    expect(sameAction(targeted, { type: "replayAttack", player: 0, attackerUid: "attacker", directAttack: true, label: "Direct replay", windowId: 4, windowKind: "battle" })).toBe(false);
  });

  it("requires replay decision responses to echo their battle window stamp", () => {
    const replay: DuelAction = { type: "replayAttack", player: 0, attackerUid: "attacker", directAttack: true, label: "Replay", windowId: 5, windowKind: "battle" };
    const cancel: DuelAction = { type: "cancelAttack", player: 0, attackerUid: "attacker", label: "Cancel", windowId: 5, windowKind: "battle" };

    expect(sameAction(replay, { type: "replayAttack", player: 0, attackerUid: "attacker", directAttack: true, label: "Replay" })).toBe(false);
    expect(sameAction(cancel, { type: "cancelAttack", player: 0, attackerUid: "attacker", label: "Cancel" })).toBe(false);
    expect(sameAction(replay, { ...replay })).toBe(true);
    expect(sameAction(cancel, { ...cancel })).toBe(true);
  });

  it("requires prompt responses to echo their prompt window stamp", () => {
    const option: DuelAction = { type: "selectOption", player: 0, promptId: "prompt", option: 2, label: "Two", windowId: 6, windowKind: "prompt" };
    const yesNo: DuelAction = { type: "selectYesNo", player: 0, promptId: "prompt", yes: false, label: "No", windowId: 6, windowKind: "prompt" };

    expect(sameAction(option, { type: "selectOption", player: 0, promptId: "prompt", option: 2, label: "Two" })).toBe(false);
    expect(sameAction(yesNo, { type: "selectYesNo", player: 0, promptId: "prompt", yes: false, label: "No" })).toBe(false);
    expect(sameAction(option, { ...option })).toBe(true);
    expect(sameAction(yesNo, { ...yesNo })).toBe(true);
  });
});
