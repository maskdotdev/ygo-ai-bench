import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua battle chain quick replay restore", () => {
  it("replays restored damage-step chain quick responses back to the battle window", () => {
    assertBattleReplayRestore("EFFECT_FLAG_DAMAGE_STEP", "startDamageStep", [1]);
  });

  it("replays restored before-damage-calculation chain quick responses back to the battle window", () => {
    assertBattleReplayRestore("EFFECT_FLAG_DAMAGE_STEP", "beforeDamageCalculation", [1, 0, 1]);
  });

  it("replays restored damage-calculation chain quick responses back to the battle window", () => {
    assertBattleReplayRestore("EFFECT_FLAG_DAMAGE_CAL", "duringDamageCalculation", [1, 0, 1, 0, 1]);
  });

  it("replays restored after-damage-calculation chain quick responses back to the battle window", () => {
    assertBattleReplayRestore("EFFECT_FLAG_DAMAGE_STEP", "afterDamageCalculation", [1, 0, 1, 0, 1, 0, 1]);
  });

  it("replays restored end-damage-step chain quick responses back to the battle window", () => {
    assertBattleReplayRestore("EFFECT_FLAG_DAMAGE_STEP", "endDamageStep", [1, 0, 1, 0, 1, 0, 1, 0, 1]);
  });
});

function assertBattleReplayRestore(property: "EFFECT_FLAG_DAMAGE_STEP" | "EFFECT_FLAG_DAMAGE_CAL", expectedWindow: string, damagePassSequence: Array<0 | 1>): void {
  const fixture = setupBattleQuickFixture(property);
  for (const player of damagePassSequence) passBattleResponse(fixture.session, player, "passDamage");
  expect(fixture.session.state.battleWindow?.kind).toBe(expectedWindow);
  activateTurnQuick(fixture.session);

  const restored = restoreDuelWithLuaScripts(serializeDuel(fixture.session), fixture.source, createCardReader(fixture.cards));
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expectRestoredLegalActions(restored, 1);
  expect(queryPublicState(restored.session)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
  const opponentQuick = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateEffect" && action.uid.includes("400"));
  expect(opponentQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
  expect(hasGroupedLuaEffect(restored, 1, "400", "chainResponse")).toBe(true);
  expect(hasGroupedLuaEffect(restored, 1, "500", "chainResponse")).toBe(false);

  const opponentChained = applyLuaRestoreAndAssert(restored, opponentQuick!);
  expect(opponentChained.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", battleWindow: { kind: expectedWindow, responsePlayer: 0 } });
  expect(opponentChained.state.chain.map((link) => link.sourceUid)).toEqual([
    expect.stringContaining("300"),
    expect.stringContaining("400"),
  ]);
  expect(restored.host.messages).toEqual([]);

  const restoredOpponentResponse = restoreDuelWithLuaScripts(serializeDuel(restored.session), fixture.source, createCardReader(fixture.cards));
  expect(restoredOpponentResponse.restoreComplete, restoredOpponentResponse.incompleteReasons.join("; ")).toBe(true);
  expectRestoredLegalActions(restoredOpponentResponse, 1);
  expect(queryPublicState(restoredOpponentResponse.session)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
  expect(restoredOpponentResponse.session.state.chain.map((link) => link.sourceUid)).toEqual([
    expect.stringContaining("300"),
    expect.stringContaining("400"),
  ]);
  expect(getLuaRestoreLegalActions(restoredOpponentResponse, 0)).toEqual([]);
  expect(getLuaRestoreLegalActionGroups(restoredOpponentResponse, 0)).toEqual([]);
  expect(getLuaRestoreLegalActions(restoredOpponentResponse, 1).some((action) => action.type === "activateEffect" && action.uid.includes("500"))).toBe(false);
  expect(getLuaRestoreLegalActionGroups(restoredOpponentResponse, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredOpponentResponse, 1));

  const pass = getLuaRestoreLegalActions(restoredOpponentResponse, 1).find((action) => action.type === "passChain");
  expect(pass).toBeDefined();
  const resolved = applyLuaRestoreAndAssert(restoredOpponentResponse, pass!);
  expect(resolved.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleWindow: { kind: expectedWindow, responsePlayer: 1 } });
  expect(restoredOpponentResponse.session.state.chainPasses).toEqual([]);
  if (expectedWindow === "duringDamageCalculation") expect(resolved.state).toMatchObject({ battleStep: "damageCalculation" });
  expect(resolved.legalActions).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "activateEffect", player: 1, windowKind: "battle", uid: expect.stringContaining("500") }),
    expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" }),
  ]));
  expect(resolved.legalActionGroups.some((group) => group.actions.some((action) => action.type === "activateEffect" && action.player === 1 && action.windowKind === "battle" && action.uid.includes("500")))).toBe(true);
  expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.uid.includes("600"))).toBe(false);
  expect(resolved.legalActionGroups.some((group) => group.actions.some((action) => action.type === "activateEffect" && action.uid.includes("600")))).toBe(false);
  const battleAction = resolved.legalActions[0];
  expect(battleAction).toBeDefined();
  const oppositeQuick = restoredOpponentResponse.session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "600");
  expect(oppositeQuick).toBeDefined();
  const oppositeQuickEffect = restoredOpponentResponse.session.state.effects.find((effect) => effect.sourceUid === oppositeQuick!.uid);
  expect(oppositeQuickEffect).toBeDefined();
  const forgedOppositeTimingQuick = applyLuaRestoreResponse(restoredOpponentResponse, {
    type: "activateEffect",
    player: 1,
    uid: oppositeQuick!.uid,
    effectId: oppositeQuickEffect!.id,
    label: "Forge opposite timing quick into restored battle window",
    windowId: battleAction!.windowId!,
    windowKind: battleAction!.windowKind!,
    windowToken: battleAction!.windowToken!,
  });
  expect(forgedOppositeTimingQuick.ok).toBe(false);
  expect(forgedOppositeTimingQuick.error).toContain("Response is not currently legal");
  expect(forgedOppositeTimingQuick.legalActions).toEqual(getDuelLegalActions(restoredOpponentResponse.session, 1));
  expect(forgedOppositeTimingQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredOpponentResponse.session, 1));
  expect(restoredOpponentResponse.host.messages).toEqual(["restored chain-only battle quick resolved", "restored battle quick resolved"]);

  const stalePass = applyLuaRestoreResponse(restoredOpponentResponse, pass!);
  expect(stalePass.ok).toBe(false);
  expect(stalePass.error).toContain("Response is not currently legal");
  expect(stalePass.legalActions).toEqual(getDuelLegalActions(restoredOpponentResponse.session, 1));
  expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredOpponentResponse.session, 1));
}

function setupBattleQuickFixture(property: "EFFECT_FLAG_DAMAGE_STEP" | "EFFECT_FLAG_DAMAGE_CAL") {
  const cards: DuelCardData[] = [
    { code: "100", name: "Replay Battle Attacker", kind: "monster", attack: 1800 },
    { code: "300", name: "Replay Battle Quick", kind: "monster" },
    { code: "400", name: "Replay Chain Battle Quick", kind: "monster" },
    { code: "500", name: "Replay Opponent Battle Quick", kind: "monster" },
    { code: "600", name: "Replay Opposite Timing Quick", kind: "monster" },
    { code: "700", name: "Replay Filler", kind: "monster" },
  ];
  const source = {
    readScript(name: string) {
      if (name === "c300.lua") return battleQuickScript(300, property, "Duel.GetCurrentChain()==0", "restored battle quick resolved");
      if (name === "c400.lua") return battleQuickScript(400, property, "Duel.GetCurrentChain()>0", "restored chain-only battle quick resolved");
      if (name === "c500.lua") return battleQuickScript(500, property, "Duel.GetCurrentChain()==0", "restored opponent battle quick resolved");
      if (name === "c600.lua") return battleQuickScript(600, oppositeBattleProperty(property), "Duel.GetCurrentChain()==0", "opposite timing quick should not resolve");
      return undefined;
    },
  };
  const session = createDuel({ seed: property === "EFFECT_FLAG_DAMAGE_STEP" ? 58 : 59, startingHandSize: 3, cardReader: createCardReader(cards) });
  loadDecks(session, { 0: { main: ["100", "300", "700"] }, 1: { main: ["400", "500", "600"] } });
  startDuel(session);
  const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
  expect(attacker).toBeDefined();
  moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";

  const host = createLuaScriptHost(session);
  expect(host.loadCardScript(300, source).ok).toBe(true);
  expect(host.loadCardScript(400, source).ok).toBe(true);
  expect(host.loadCardScript(500, source).ok).toBe(true);
  expect(host.loadCardScript(600, source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(4);

  applyNamedAction(session, 0, (action) => action.type === "changePhase" && action.phase === "battle");
  applyNamedAction(session, 0, (action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === undefined);
  passBattleResponse(session, 1, "passAttack");
  passBattleResponse(session, 0, "passAttack");
  expect(session.state.battleWindow?.kind).toBe("startDamageStep");
  return { cards, session, source };
}

function battleQuickScript(code: number, property: "EFFECT_FLAG_DAMAGE_STEP" | "EFFECT_FLAG_DAMAGE_CAL", condition: string, message: string): string {
  return `
  c${code}={}
  function c${code}.initial_effect(c)
    local e=Effect.CreateEffect(c)
    e:SetType(EFFECT_TYPE_QUICK_O)
    e:SetProperty(${property})
    e:SetRange(LOCATION_HAND)
    e:SetCondition(function(e,tp) return ${condition} end)
    e:SetOperation(function(e,tp) Debug.Message("${message}") end)
    c:RegisterEffect(e)
  end
  `;
}

function oppositeBattleProperty(property: "EFFECT_FLAG_DAMAGE_STEP" | "EFFECT_FLAG_DAMAGE_CAL"): "EFFECT_FLAG_DAMAGE_STEP" | "EFFECT_FLAG_DAMAGE_CAL" {
  return property === "EFFECT_FLAG_DAMAGE_STEP" ? "EFFECT_FLAG_DAMAGE_CAL" : "EFFECT_FLAG_DAMAGE_STEP";
}

function activateTurnQuick(session: ReturnType<typeof createDuel>): void {
  applyNamedAction(session, 0, (action) => action.type === "activateEffect" && action.uid.includes("300"));
}

function passBattleResponse(session: ReturnType<typeof createDuel>, player: 0 | 1, type: "passAttack" | "passDamage"): void {
  applyNamedAction(session, player, (action) => action.type === type);
}

function applyNamedAction(session: ReturnType<typeof createDuel>, player: 0 | 1, predicate: (action: ReturnType<typeof getDuelLegalActions>[number]) => boolean): void {
  const action = getDuelLegalActions(session, player).find(predicate);
  expect(action).toBeDefined();
  expect(applyResponse(session, action!).ok).toBe(true);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function hasGroupedLuaEffect(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, code: string, windowKind: "battle" | "chainResponse"): boolean {
  return getLuaRestoreLegalActionGroups(restored, player).some((group) =>
    group.windowKind === windowKind && group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.uid.includes(code) && action.windowKind === windowKind),
  );
}
