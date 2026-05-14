import { describe, expect, it } from "vitest";
import { describeDuelActionSelector, duelActionMatchesSelector, selectDuelActionBySelector } from "#duel/action-selectors.js";
import { sameAction } from "#duel/response-match.js";
import type { DuelAction } from "#duel/types.js";

describe("duel response matching", () => {
  const windowToken = (windowId: number) => `window-${windowId}`;
  const stampedActionExamples: DuelAction[] = [
    { type: "normalSummon", player: 0, uid: "normal", label: "Normal", windowId: 20, windowKind: "open", windowToken: windowToken(20) },
    { type: "tributeSummon", player: 0, uid: "tribute", tributeUids: ["mat-a"], label: "Tribute", windowId: 20, windowKind: "open", windowToken: windowToken(20) },
    { type: "fusionSummon", player: 0, uid: "fusion", materialUids: ["mat-a", "mat-b"], label: "Fusion", windowId: 20, windowKind: "open", windowToken: windowToken(20) },
    { type: "synchroSummon", player: 0, uid: "synchro", materialUids: ["mat-a", "mat-b"], label: "Synchro", windowId: 20, windowKind: "open", windowToken: windowToken(20) },
    { type: "xyzSummon", player: 0, uid: "xyz", materialUids: ["mat-a", "mat-b"], label: "Xyz", windowId: 20, windowKind: "open", windowToken: windowToken(20) },
    { type: "linkSummon", player: 0, uid: "link", materialUids: ["mat-a", "mat-b"], label: "Link", windowId: 20, windowKind: "open", windowToken: windowToken(20) },
    { type: "ritualSummon", player: 0, uid: "ritual", materialUids: ["mat-a", "mat-b"], label: "Ritual", windowId: 20, windowKind: "open", windowToken: windowToken(20) },
    { type: "setMonster", player: 0, uid: "monster", label: "Set monster", windowId: 20, windowKind: "open", windowToken: windowToken(20) },
    { type: "setSpellTrap", player: 0, uid: "spell", label: "Set spell", windowId: 20, windowKind: "open", windowToken: windowToken(20) },
    { type: "activateEffect", player: 0, uid: "effect-source", effectId: "effect", label: "Effect", windowId: 20, windowKind: "chainResponse", windowToken: windowToken(20) },
    { type: "specialSummonProcedure", player: 0, uid: "procedure", effectId: "procedure-effect", label: "Procedure", windowId: 20, windowKind: "open", windowToken: windowToken(20) },
    { type: "passChain", player: 0, label: "Pass chain", windowId: 20, windowKind: "chainResponse", windowToken: windowToken(20) },
    { type: "passAttack", player: 0, label: "Pass attack", windowId: 20, windowKind: "battle", windowToken: windowToken(20) },
    { type: "passDamage", player: 0, label: "Pass damage", windowId: 20, windowKind: "battle", windowToken: windowToken(20) },
    { type: "replayAttack", player: 0, attackerUid: "attacker", targetUid: "target", label: "Replay", windowId: 20, windowKind: "battle", windowToken: windowToken(20) },
    { type: "cancelAttack", player: 0, attackerUid: "attacker", label: "Cancel", windowId: 20, windowKind: "battle", windowToken: windowToken(20) },
    { type: "selectOption", player: 0, promptId: "prompt", option: 1, label: "One", windowId: 20, windowKind: "prompt", windowToken: windowToken(20) },
    { type: "selectYesNo", player: 0, promptId: "prompt", yes: true, label: "Yes", windowId: 20, windowKind: "prompt", windowToken: windowToken(20) },
    { type: "activateTrigger", player: 0, triggerId: "trigger", triggerBucket: "turnOptional", uid: "trigger-source", effectId: "trigger-effect", label: "Activate", windowId: 20, windowKind: "triggerBucket", windowToken: windowToken(20) },
    { type: "declineTrigger", player: 0, triggerId: "trigger", triggerBucket: "turnOptional", uid: "trigger-source", effectId: "trigger-effect", label: "Decline", windowId: 20, windowKind: "triggerBucket", windowToken: windowToken(20) },
    { type: "flipSummon", player: 0, uid: "flip", label: "Flip", windowId: 20, windowKind: "open", windowToken: windowToken(20) },
    { type: "changePosition", player: 0, uid: "position", position: "faceUpDefense", label: "Defense", windowId: 20, windowKind: "open", windowToken: windowToken(20) },
    { type: "declareAttack", player: 0, attackerUid: "attacker", directAttack: true, label: "Direct", windowId: 20, windowKind: "open", windowToken: windowToken(20) },
    { type: "changePhase", player: 0, phase: "battle", label: "Battle Phase", windowId: 20, windowKind: "open", windowToken: windowToken(20) },
    { type: "endTurn", player: 0, label: "End Turn", windowId: 20, windowKind: "open", windowToken: windowToken(20) },
  ];

  it("requires every stamped legal action type to echo its window stamp", () => {
    expect(stampedActionExamples.map((action) => action.type)).toEqual([
      "normalSummon",
      "tributeSummon",
      "fusionSummon",
      "synchroSummon",
      "xyzSummon",
      "linkSummon",
      "ritualSummon",
      "setMonster",
      "setSpellTrap",
      "activateEffect",
      "specialSummonProcedure",
      "passChain",
      "passAttack",
      "passDamage",
      "replayAttack",
      "cancelAttack",
      "selectOption",
      "selectYesNo",
      "activateTrigger",
      "declineTrigger",
      "flipSummon",
      "changePosition",
      "declareAttack",
      "changePhase",
      "endTurn",
    ]);
    for (const action of stampedActionExamples) {
      const { windowId: _windowId, windowKind: _windowKind, windowToken: _windowToken, ...unstamped } = action;
      expect(sameAction(action, unstamped)).toBe(false);
      expect(sameAction(action, { ...action })).toBe(true);
    }
  });

  it("rejects partial tokenized window stamps", () => {
    const action: DuelAction = { type: "passChain", player: 0, label: "Pass chain", windowId: 21, windowKind: "chainResponse", windowToken: windowToken(21) };
    const { windowToken: _windowToken, ...missingToken } = action;
    const { windowId: _windowId, windowKind: _windowKind, ...tokenOnly } = action;

    expect(sameAction(action, missingToken)).toBe(false);
    expect(sameAction(action, tokenOnly)).toBe(false);
    expect(sameAction({ type: "passChain", player: 0, label: "Pass chain" }, tokenOnly)).toBe(false);
  });

  it("rejects malformed numeric window ids", () => {
    const action: DuelAction = { type: "passChain", player: 0, label: "Pass chain", windowId: 23, windowKind: "chainResponse", windowToken: windowToken(23) };
    const response = { ...action };

    for (const windowId of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(sameAction(action, { ...response, windowId })).toBe(false);
    }
  });

  it("matches unordered summon material responses without accepting duplicates", () => {
    const action: DuelAction = {
      type: "fusionSummon",
      player: 0,
      uid: "fusion",
      materialUids: ["mat-a", "mat-b"],
      label: "Fusion",
      windowId: 1,
      windowKind: "open",
      windowToken: windowToken(1),
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

  it("matches fixture selectors by action window token", () => {
    const action: DuelAction = {
      type: "passChain",
      player: 0,
      label: "Pass chain",
      windowId: 22,
      windowKind: "chainResponse",
      windowToken: windowToken(22),
    };

    const { windowToken: _windowToken, ...unstampedAction } = action;

    expect(duelActionMatchesSelector(action, { type: "passChain", player: 0, windowToken: windowToken(22) }, [])).toBe(true);
    expect(duelActionMatchesSelector(action, { type: "passChain", player: 0, windowToken: "forged-window" }, [])).toBe(false);
    expect(duelActionMatchesSelector(unstampedAction, { type: "passChain", player: 0, windowToken: windowToken(22) }, [])).toBe(false);
  });

  it("matches prompt fixture selectors by prompt id, choice, and window token", () => {
    const option: DuelAction = {
      type: "selectOption",
      player: 1,
      promptId: "lua-prompt-1",
      option: 4,
      label: "Select option 4",
      windowId: 24,
      windowKind: "prompt",
      windowToken: windowToken(24),
    };
    const yesNo: DuelAction = {
      type: "selectYesNo",
      player: 1,
      promptId: "lua-prompt-2",
      yes: false,
      label: "No",
      windowId: 25,
      windowKind: "prompt",
      windowToken: windowToken(25),
    };

    expect(duelActionMatchesSelector(option, { type: "selectOption", player: 1, promptId: "lua-prompt-1", option: 4, windowKind: "prompt", windowToken: windowToken(24) }, [])).toBe(true);
    expect(duelActionMatchesSelector(option, { type: "selectOption", player: 1, promptId: "lua-prompt-1", option: 2, windowKind: "prompt", windowToken: windowToken(24) }, [])).toBe(false);
    expect(duelActionMatchesSelector(option, { type: "selectOption", player: 1, promptId: "lua-prompt-1", option: 4, windowKind: "prompt", windowToken: windowToken(25) }, [])).toBe(false);
    expect(duelActionMatchesSelector(yesNo, { type: "selectYesNo", player: 1, promptId: "lua-prompt-2", yes: false, windowKind: "prompt", windowToken: windowToken(25) }, [])).toBe(true);
    expect(duelActionMatchesSelector(yesNo, { type: "selectYesNo", player: 1, promptId: "lua-prompt-2", yes: true, windowKind: "prompt", windowToken: windowToken(25) }, [])).toBe(false);
    expect(duelActionMatchesSelector(yesNo, { type: "selectYesNo", player: 1, promptId: "lua-prompt-2", yes: false, windowKind: "prompt", windowToken: windowToken(24) }, [])).toBe(false);
  });

  it("rejects malformed numeric fixture selector window ids", () => {
    const action: DuelAction = {
      type: "passChain",
      player: 0,
      label: "Pass chain",
      windowId: 22,
      windowKind: "chainResponse",
      windowToken: windowToken(22),
    };

    for (const windowId of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(duelActionMatchesSelector(action, { type: "passChain", player: 0, windowId }, [])).toBe(false);
    }
  });

  it("rejects malformed fixture selector window stamps", () => {
    const action: DuelAction = {
      type: "passChain",
      player: 0,
      label: "Pass chain",
      windowId: 22,
      windowKind: "chainResponse",
      windowToken: windowToken(22),
    };

    expect(duelActionMatchesSelector(action, { type: "passChain", player: 0, windowKind: "bogus" as "open" }, [])).toBe(false);
    expect(duelActionMatchesSelector(action, { type: "passChain", player: 0, windowKind: "" as "open" }, [])).toBe(false);
    expect(duelActionMatchesSelector(action, { type: "passChain", player: 0, windowToken: "" }, [])).toBe(false);
    expect(describeDuelActionSelector({ type: "passChain", player: 0, windowKind: "bogus" as "open", windowToken: "" })).toContain("windowKind=bogus");
    expect(describeDuelActionSelector({ type: "passChain", player: 0, windowKind: "bogus" as "open", windowToken: "" })).toContain("windowToken=");
  });

  it("selects fixture action occurrences explicitly", () => {
    const first: DuelAction = {
      type: "changePhase",
      player: 0,
      phase: "battle",
      label: "Battle Phase",
      windowId: 22,
      windowKind: "open",
      windowToken: windowToken(22),
    };
    const second: DuelAction = { ...first, label: "Battle Phase copy" };

    expect(selectDuelActionBySelector([first, second], { type: "changePhase", player: 0, phase: "battle" }, [])).toBe(first);
    expect(selectDuelActionBySelector([first, second], { type: "changePhase", player: 0, phase: "battle", occurrence: 1 }, [])).toBe(second);
  });

  it("rejects malformed fixture selector occurrences", () => {
    const action: DuelAction = {
      type: "passChain",
      player: 0,
      label: "Pass chain",
      windowId: 22,
      windowKind: "chainResponse",
      windowToken: windowToken(22),
    };

    for (const occurrence of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(selectDuelActionBySelector([action], { type: "passChain", player: 0, occurrence }, [])).toBeUndefined();
    }
    expect(describeDuelActionSelector({ type: "passChain", player: 0, occurrence: Number.NaN })).toContain("occurrence=NaN");
  });

  it("does not ignore empty fixture selector identifiers", () => {
    const action: DuelAction = {
      type: "activateTrigger",
      player: 0,
      triggerId: "trigger",
      triggerBucket: "turnOptional",
      uid: "card",
      effectId: "effect",
      label: "Activate",
      windowId: 22,
      windowKind: "triggerBucket",
      windowToken: windowToken(22),
    };

    expect(duelActionMatchesSelector(action, { type: "activateTrigger", player: 0, uid: "" }, [])).toBe(false);
    expect(duelActionMatchesSelector(action, { type: "activateTrigger", player: 0, effectId: "" }, [])).toBe(false);
    expect(duelActionMatchesSelector(action, { type: "activateTrigger", player: 0, triggerId: "" }, [])).toBe(false);
    expect(duelActionMatchesSelector(action, { type: "activateTrigger", player: 0, triggerBucket: "" as "turnOptional" }, [])).toBe(false);
    expect(describeDuelActionSelector({ type: "activateTrigger", player: 0, uid: "" })).toContain("uid=");
  });

  it("does not ignore empty prompt selector fields", () => {
    const option: DuelAction = {
      type: "selectOption",
      player: 0,
      promptId: "prompt",
      option: 1,
      label: "Select option 1",
      windowId: 26,
      windowKind: "prompt",
      windowToken: windowToken(26),
    };
    const yesNo: DuelAction = {
      type: "selectYesNo",
      player: 0,
      promptId: "prompt",
      yes: true,
      label: "Yes",
      windowId: 26,
      windowKind: "prompt",
      windowToken: windowToken(26),
    };

    expect(duelActionMatchesSelector(option, { type: "selectOption", player: 0, promptId: "" }, [])).toBe(false);
    expect(duelActionMatchesSelector(option, { type: "selectOption", player: 0, promptId: "prompt", labelIncludes: "" }, [])).toBe(false);
    expect(duelActionMatchesSelector(yesNo, { type: "selectYesNo", player: 0, promptId: "" }, [])).toBe(false);
    expect(duelActionMatchesSelector(yesNo, { type: "selectYesNo", player: 0, promptId: "prompt", labelIncludes: "" }, [])).toBe(false);
    expect(describeDuelActionSelector({ type: "selectOption", player: 0, promptId: "" })).toContain("promptId=");
    expect(describeDuelActionSelector({ type: "selectYesNo", player: 0, promptId: "", labelIncludes: "" })).toContain("labelIncludes=");
  });

  it("does not ignore empty fixture selector filters", () => {
    const attack: DuelAction = {
      type: "declareAttack",
      player: 0,
      attackerUid: "attacker",
      targetUid: "target",
      label: "Attack target",
      windowId: 22,
      windowKind: "open",
      windowToken: windowToken(22),
    };
    const phase: DuelAction = {
      type: "changePhase",
      player: 0,
      phase: "battle",
      label: "Battle Phase",
      windowId: 22,
      windowKind: "open",
      windowToken: windowToken(22),
    };
    const summon: DuelAction = {
      type: "normalSummon",
      player: 0,
      uid: "card",
      label: "Normal Summon",
      windowId: 22,
      windowKind: "open",
      windowToken: windowToken(22),
    };
    const cards = [{ uid: "card", code: "100", location: "hand" as const }];

    expect(duelActionMatchesSelector(attack, { type: "declareAttack", player: 0, attackerUid: "" }, [])).toBe(false);
    expect(duelActionMatchesSelector(attack, { type: "declareAttack", player: 0, targetUid: "" }, [])).toBe(false);
    expect(duelActionMatchesSelector(phase, { type: "changePhase", player: 0, phase: "" as "battle" }, [])).toBe(false);
    expect(duelActionMatchesSelector(summon, { type: "normalSummon", player: 0, code: "" }, cards)).toBe(false);
    expect(duelActionMatchesSelector(summon, { type: "normalSummon", player: 0, location: "" as "hand" }, cards)).toBe(false);
    expect(duelActionMatchesSelector(summon, { type: "normalSummon", player: 0, labelIncludes: "" }, cards)).toBe(false);
    expect(describeDuelActionSelector({ type: "normalSummon", player: 0, code: "", location: "" as "hand", labelIncludes: "" })).toContain("code=");
  });

  it("describes fixture selectors with action window tokens", () => {
    expect(describeDuelActionSelector({ type: "passChain", player: 0, windowToken: windowToken(22) })).toContain("windowToken=window-22");
  });

  it("matches direct attack selectors by explicit direct attack marker", () => {
    const direct: DuelAction = { type: "declareAttack", player: 0, attackerUid: "attacker", directAttack: true, label: "Direct", windowId: 3, windowKind: "open", windowToken: windowToken(3) };
    const unstamped: DuelAction = { type: "declareAttack", player: 0, attackerUid: "attacker", label: "Legacy untargeted", windowId: 3, windowKind: "open", windowToken: windowToken(3) };

    expect(duelActionMatchesSelector(direct, { type: "declareAttack", player: 0, directAttack: true }, [])).toBe(true);
    expect(duelActionMatchesSelector(unstamped, { type: "declareAttack", player: 0, directAttack: true }, [])).toBe(false);
  });

  it("describes direct attack selectors with their explicit direct attack intent", () => {
    expect(describeDuelActionSelector({ type: "replayAttack", player: 0, attackerUid: "attacker", directAttack: true })).toContain("directAttack=true");
    expect(describeDuelActionSelector({ type: "replayAttack", player: 0, attackerUid: "attacker", directAttack: false })).toContain("directAttack=false");
  });

  it("matches explicit direct attack responses only to direct attack actions", () => {
    const direct: DuelAction = { type: "declareAttack", player: 0, attackerUid: "attacker", directAttack: true, label: "Direct", windowId: 3, windowKind: "open", windowToken: windowToken(3) };
    const targeted: DuelAction = { type: "declareAttack", player: 0, attackerUid: "attacker", targetUid: "target", label: "Target", windowId: 3, windowKind: "open", windowToken: windowToken(3) };

    expect(sameAction(direct, { ...direct, directAttack: true })).toBe(true);
    expect(sameAction(direct, { type: "declareAttack", player: 0, attackerUid: "attacker", label: "Direct", windowId: 3, windowKind: "open", windowToken: windowToken(3), directAttack: true })).toBe(true);
    expect(sameAction(direct, { type: "declareAttack", player: 0, attackerUid: "attacker", label: "Direct", windowId: 3, windowKind: "open", windowToken: windowToken(3) })).toBe(false);
    expect(sameAction(direct, { type: "declareAttack", player: 0, attackerUid: "attacker", label: "Direct", directAttack: true })).toBe(false);
    expect(sameAction(targeted, { type: "declareAttack", player: 0, attackerUid: "attacker", directAttack: true, label: "Direct", windowId: 3, windowKind: "open", windowToken: windowToken(3) })).toBe(false);
  });

  it("matches explicit direct replay responses only to direct replay actions", () => {
    const direct: DuelAction = { type: "replayAttack", player: 0, attackerUid: "attacker", directAttack: true, label: "Direct replay", windowId: 4, windowKind: "battle", windowToken: windowToken(4) };
    const targeted: DuelAction = { type: "replayAttack", player: 0, attackerUid: "attacker", targetUid: "target", label: "Replay target", windowId: 4, windowKind: "battle", windowToken: windowToken(4) };

    expect(sameAction(direct, { ...direct, directAttack: true })).toBe(true);
    expect(sameAction(direct, { type: "replayAttack", player: 0, attackerUid: "attacker", label: "Direct replay", windowId: 4, windowKind: "battle" })).toBe(false);
    expect(sameAction(targeted, { type: "replayAttack", player: 0, attackerUid: "attacker", directAttack: true, label: "Direct replay", windowId: 4, windowKind: "battle", windowToken: windowToken(4) })).toBe(false);
  });

  it("requires replay decision responses to echo their battle window stamp", () => {
    const replay: DuelAction = { type: "replayAttack", player: 0, attackerUid: "attacker", directAttack: true, label: "Replay", windowId: 5, windowKind: "battle", windowToken: windowToken(5) };
    const cancel: DuelAction = { type: "cancelAttack", player: 0, attackerUid: "attacker", label: "Cancel", windowId: 5, windowKind: "battle", windowToken: windowToken(5) };

    expect(sameAction(replay, { type: "replayAttack", player: 0, attackerUid: "attacker", directAttack: true, label: "Replay" })).toBe(false);
    expect(sameAction(cancel, { type: "cancelAttack", player: 0, attackerUid: "attacker", label: "Cancel" })).toBe(false);
    expect(sameAction(replay, { ...replay })).toBe(true);
    expect(sameAction(cancel, { ...cancel })).toBe(true);
  });

  it("requires prompt responses to echo their prompt window stamp", () => {
    const option: DuelAction = { type: "selectOption", player: 0, promptId: "prompt", option: 2, label: "Two", windowId: 6, windowKind: "prompt", windowToken: windowToken(6) };
    const yesNo: DuelAction = { type: "selectYesNo", player: 0, promptId: "prompt", yes: false, label: "No", windowId: 6, windowKind: "prompt", windowToken: windowToken(6) };

    expect(sameAction(option, { type: "selectOption", player: 0, promptId: "prompt", option: 2, label: "Two" })).toBe(false);
    expect(sameAction(yesNo, { type: "selectYesNo", player: 0, promptId: "prompt", yes: false, label: "No" })).toBe(false);
    expect(sameAction(option, { ...option })).toBe(true);
    expect(sameAction(yesNo, { ...yesNo })).toBe(true);
  });

  it("requires trigger bucket responses to echo their trigger window stamp", () => {
    const activate: DuelAction = { type: "activateTrigger", player: 0, triggerId: "trigger", triggerBucket: "turnOptional", uid: "card", effectId: "effect", label: "Activate", windowId: 7, windowKind: "triggerBucket", windowToken: windowToken(7) };
    const decline: DuelAction = { type: "declineTrigger", player: 0, triggerId: "trigger", triggerBucket: "turnOptional", uid: "card", effectId: "effect", label: "Decline", windowId: 7, windowKind: "triggerBucket", windowToken: windowToken(7) };

    expect(sameAction(activate, { type: "activateTrigger", player: 0, triggerId: "trigger", triggerBucket: "turnOptional", uid: "card", effectId: "effect", label: "Activate" })).toBe(false);
    expect(sameAction(decline, { type: "declineTrigger", player: 0, triggerId: "trigger", triggerBucket: "turnOptional", uid: "card", effectId: "effect", label: "Decline" })).toBe(false);
    expect(sameAction(activate, { ...activate })).toBe(true);
    expect(sameAction(decline, { ...decline })).toBe(true);
  });

  it("requires battle pass responses to echo their battle window stamp", () => {
    const attackPass: DuelAction = { type: "passAttack", player: 1, label: "Pass attack", windowId: 8, windowKind: "battle", windowToken: windowToken(8) };
    const damagePass: DuelAction = { type: "passDamage", player: 0, label: "Pass damage", windowId: 9, windowKind: "battle", windowToken: windowToken(9) };

    expect(sameAction(attackPass, { type: "passAttack", player: 1, label: "Pass attack" })).toBe(false);
    expect(sameAction(damagePass, { type: "passDamage", player: 0, label: "Pass damage" })).toBe(false);
    expect(sameAction(attackPass, { ...attackPass })).toBe(true);
    expect(sameAction(damagePass, { ...damagePass })).toBe(true);
  });

  it("requires chain pass responses to echo their chain window stamp", () => {
    const pass: DuelAction = { type: "passChain", player: 1, label: "Pass chain", windowId: 10, windowKind: "chainResponse", windowToken: windowToken(10) };

    expect(sameAction(pass, { type: "passChain", player: 1, label: "Pass chain" })).toBe(false);
    expect(sameAction(pass, { ...pass })).toBe(true);
  });

  it("requires effect activation responses to echo their action window stamp", () => {
    const effect: DuelAction = { type: "activateEffect", player: 0, uid: "card", effectId: "effect", label: "Effect", windowId: 11, windowKind: "chainResponse", windowToken: windowToken(11) };

    expect(sameAction(effect, { type: "activateEffect", player: 0, uid: "card", effectId: "effect", label: "Effect" })).toBe(false);
    expect(sameAction(effect, { ...effect })).toBe(true);
  });

  it("requires special summon procedure responses to echo their action window stamp", () => {
    const procedure: DuelAction = { type: "specialSummonProcedure", player: 0, uid: "card", effectId: "procedure", label: "Procedure", windowId: 12, windowKind: "open", windowToken: windowToken(12) };

    expect(sameAction(procedure, { type: "specialSummonProcedure", player: 0, uid: "card", effectId: "procedure", label: "Procedure" })).toBe(false);
    expect(sameAction(procedure, { ...procedure })).toBe(true);
  });

  it("requires summon responses to echo their open window stamp", () => {
    const normal: DuelAction = { type: "normalSummon", player: 0, uid: "monster", label: "Normal", windowId: 13, windowKind: "open", windowToken: windowToken(13) };
    const tribute: DuelAction = { type: "tributeSummon", player: 0, uid: "monster", tributeUids: ["tribute"], label: "Tribute", windowId: 13, windowKind: "open", windowToken: windowToken(13) };
    const fusion: DuelAction = { type: "fusionSummon", player: 0, uid: "fusion", materialUids: ["mat-a", "mat-b"], label: "Fusion", windowId: 13, windowKind: "open", windowToken: windowToken(13) };

    expect(sameAction(normal, { type: "normalSummon", player: 0, uid: "monster", label: "Normal" })).toBe(false);
    expect(sameAction(tribute, { type: "tributeSummon", player: 0, uid: "monster", tributeUids: ["tribute"], label: "Tribute" })).toBe(false);
    expect(sameAction(fusion, { type: "fusionSummon", player: 0, uid: "fusion", materialUids: ["mat-b", "mat-a"], label: "Fusion" })).toBe(false);
    expect(sameAction(normal, { ...normal })).toBe(true);
    expect(sameAction(tribute, { ...tribute })).toBe(true);
    expect(sameAction(fusion, { ...fusion, materialUids: ["mat-b", "mat-a"] })).toBe(true);
  });

  it("requires manual board action responses to echo their open window stamp", () => {
    const setMonster: DuelAction = { type: "setMonster", player: 0, uid: "monster", label: "Set monster", windowId: 14, windowKind: "open", windowToken: windowToken(14) };
    const setSpellTrap: DuelAction = { type: "setSpellTrap", player: 0, uid: "spell", label: "Set spell", windowId: 14, windowKind: "open", windowToken: windowToken(14) };
    const flip: DuelAction = { type: "flipSummon", player: 0, uid: "monster", label: "Flip", windowId: 14, windowKind: "open", windowToken: windowToken(14) };
    const position: DuelAction = { type: "changePosition", player: 0, uid: "monster", position: "faceUpDefense", label: "Defense", windowId: 14, windowKind: "open", windowToken: windowToken(14) };

    expect(sameAction(setMonster, { type: "setMonster", player: 0, uid: "monster", label: "Set monster" })).toBe(false);
    expect(sameAction(setSpellTrap, { type: "setSpellTrap", player: 0, uid: "spell", label: "Set spell" })).toBe(false);
    expect(sameAction(flip, { type: "flipSummon", player: 0, uid: "monster", label: "Flip" })).toBe(false);
    expect(sameAction(position, { type: "changePosition", player: 0, uid: "monster", position: "faceUpDefense", label: "Defense" })).toBe(false);
    expect(sameAction(setMonster, { ...setMonster })).toBe(true);
    expect(sameAction(setSpellTrap, { ...setSpellTrap })).toBe(true);
    expect(sameAction(flip, { ...flip })).toBe(true);
    expect(sameAction(position, { ...position })).toBe(true);
  });

  it("requires turn-flow responses to echo their open window stamp", () => {
    const phase: DuelAction = { type: "changePhase", player: 0, phase: "battle", label: "Battle Phase", windowId: 15, windowKind: "open", windowToken: windowToken(15) };
    const endTurn: DuelAction = { type: "endTurn", player: 0, label: "End Turn", windowId: 15, windowKind: "open", windowToken: windowToken(15) };

    expect(sameAction(phase, { type: "changePhase", player: 0, phase: "battle", label: "Battle Phase" })).toBe(false);
    expect(sameAction(endTurn, { type: "endTurn", player: 0, label: "End Turn" })).toBe(false);
    expect(sameAction(phase, { ...phase })).toBe(true);
    expect(sameAction(endTurn, { ...endTurn })).toBe(true);
  });
});
