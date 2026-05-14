import { describe, expect, it } from "vitest";
import { duelActionAnchorUids, isOrphanDuelAction, partitionDuelActionsByAnchor } from "../src/playtest-app/duel-action-anchors.js";
import type { DuelAction } from "#duel/types.js";

describe("duel action anchors", () => {
  it("classifies every duel action variant by its UI anchors", () => {
    const cases: Array<{ action: DuelAction; anchors: string[] }> = [
      { action: { type: "normalSummon", player: 0, uid: "normal", label: "Normal Summon" }, anchors: ["normal"] },
      { action: { type: "tributeSummon", player: 0, uid: "tribute-summon", tributeUids: ["tribute-a", "tribute-b"], label: "Tribute Summon" }, anchors: ["tribute-summon", "tribute-a", "tribute-b"] },
      { action: { type: "tributeSet", player: 0, uid: "tribute-set", tributeUids: ["tribute-c"], label: "Tribute Set" }, anchors: ["tribute-set", "tribute-c"] },
      { action: { type: "fusionSummon", player: 0, uid: "fusion", materialUids: ["fusion-mat-a", "fusion-mat-b"], label: "Fusion Summon" }, anchors: ["fusion", "fusion-mat-a", "fusion-mat-b"] },
      { action: { type: "synchroSummon", player: 0, uid: "synchro", materialUids: ["synchro-mat-a", "synchro-mat-b"], label: "Synchro Summon" }, anchors: ["synchro", "synchro-mat-a", "synchro-mat-b"] },
      { action: { type: "xyzSummon", player: 0, uid: "xyz", materialUids: ["xyz-mat-a", "xyz-mat-b"], label: "Xyz Summon" }, anchors: ["xyz", "xyz-mat-a", "xyz-mat-b"] },
      { action: { type: "linkSummon", player: 0, uid: "link", materialUids: ["link-mat-a", "link-mat-b"], label: "Link Summon" }, anchors: ["link", "link-mat-a", "link-mat-b"] },
      { action: { type: "ritualSummon", player: 0, uid: "ritual", materialUids: ["ritual-mat-a", "ritual-mat-b"], label: "Ritual Summon" }, anchors: ["ritual", "ritual-mat-a", "ritual-mat-b"] },
      { action: { type: "pendulumSummon", player: 0, summonUids: ["pendulum-a", "pendulum-b"], maxSummons: 2, label: "Pendulum Summon" }, anchors: ["pendulum-a", "pendulum-b"] },
      { action: { type: "setMonster", player: 0, uid: "set-monster", label: "Set" }, anchors: ["set-monster"] },
      { action: { type: "setSpellTrap", player: 0, uid: "set-spell", label: "Set" }, anchors: ["set-spell"] },
      { action: { type: "activateEffect", player: 0, uid: "effect-source", effectId: "effect", label: "Activate" }, anchors: ["effect-source"] },
      { action: { type: "specialSummonProcedure", player: 0, uid: "procedure", effectId: "procedure-effect", label: "Special Summon" }, anchors: ["procedure"] },
      { action: { type: "passChain", player: 0, label: "Pass" }, anchors: [] },
      { action: { type: "passAttack", player: 0, label: "Pass" }, anchors: [] },
      { action: { type: "passDamage", player: 0, label: "Pass" }, anchors: [] },
      { action: { type: "replayAttack", player: 0, attackerUid: "replay-attacker", targetUid: "replay-target", label: "Attack" }, anchors: ["replay-attacker", "replay-target"] },
      { action: { type: "replayAttack", player: 0, attackerUid: "replay-direct", directAttack: true, label: "Direct Attack" }, anchors: ["replay-direct"] },
      { action: { type: "cancelAttack", player: 0, attackerUid: "cancel-attacker", label: "Cancel Attack" }, anchors: ["cancel-attacker"] },
      { action: { type: "selectOption", player: 0, promptId: "option-prompt", option: 1, label: "Option" }, anchors: [] },
      { action: { type: "selectYesNo", player: 0, promptId: "yes-no-prompt", yes: true, label: "Yes" }, anchors: [] },
      { action: { type: "activateTrigger", player: 0, triggerId: "trigger", triggerBucket: "turnOptional", uid: "trigger-source", effectId: "trigger-effect", label: "Activate" }, anchors: ["trigger-source"] },
      { action: { type: "declineTrigger", player: 0, triggerId: "decline", triggerBucket: "turnOptional", uid: "decline-source", effectId: "decline-effect", label: "Decline" }, anchors: ["decline-source"] },
      { action: { type: "flipSummon", player: 0, uid: "flip", label: "Flip Summon" }, anchors: ["flip"] },
      { action: { type: "changePosition", player: 0, uid: "position", position: "faceUpAttack", label: "Attack Position" }, anchors: ["position"] },
      { action: { type: "declareAttack", player: 0, attackerUid: "attacker", targetUid: "target", label: "Attack" }, anchors: ["attacker", "target"] },
      { action: { type: "declareAttack", player: 0, attackerUid: "direct-attacker", directAttack: true, label: "Direct Attack" }, anchors: ["direct-attacker"] },
      { action: { type: "changePhase", player: 0, phase: "battle", label: "Battle Phase" }, anchors: [] },
      { action: { type: "endTurn", player: 0, label: "End Turn" }, anchors: [] },
    ];

    for (const { action, anchors } of cases) {
      expect(duelActionAnchorUids(action), action.type).toEqual(anchors);
      expect(isOrphanDuelAction(action), action.type).toBe(anchors.length === 0);
    }
  });

  it("anchors Pendulum Summon actions to every summoned card", () => {
    const action: DuelAction = {
      type: "pendulumSummon",
      player: 0,
      summonUids: ["hand-1", "extra-1"],
      maxSummons: 2,
      label: "Pendulum Summon",
      windowId: 4,
      windowKind: "open",
      windowToken: "window-4",
    };

    expect(duelActionAnchorUids(action)).toEqual(["hand-1", "extra-1"]);
    expect(isOrphanDuelAction(action)).toBe(false);
  });

  it("keeps prompt and pass actions in the global orphan strip", () => {
    const actions: DuelAction[] = [
      { type: "selectOption", player: 0, promptId: "option-prompt", option: 2, label: "Select option 2", windowId: 5, windowKind: "prompt", windowToken: "prompt-5" },
      { type: "selectYesNo", player: 0, promptId: "yes-no-prompt", yes: true, label: "Yes", windowId: 5, windowKind: "prompt", windowToken: "prompt-5" },
      { type: "passChain", player: 1, label: "Pass", windowId: 6, windowKind: "chainResponse" },
    ];

    const partitioned = partitionDuelActionsByAnchor(actions);

    expect(partitioned.byUid.size).toBe(0);
    expect(partitioned.orphans).toEqual(actions);
    expect(partitioned.orphans.map((action) => action.windowKind)).toEqual(["prompt", "prompt", "chainResponse"]);
    expect(partitioned.orphans.filter((action) => action.windowKind === "prompt").map((action) => action.windowToken)).toEqual(["prompt-5", "prompt-5"]);
  });

  it("dedupes one engine action across multiple card anchors", () => {
    const action: DuelAction = {
      type: "fusionSummon",
      player: 0,
      uid: "extra-fusion",
      materialUids: ["field-1", "hand-1"],
      label: "Fusion Summon",
    };

    const partitioned = partitionDuelActionsByAnchor([action, action]);

    expect(partitioned.byUid.get("extra-fusion")).toEqual([action]);
    expect(partitioned.byUid.get("field-1")).toEqual([action]);
    expect(partitioned.byUid.get("hand-1")).toEqual([action]);
    expect(partitioned.orphans).toEqual([]);
  });
});
