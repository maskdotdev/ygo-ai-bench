import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const maliciousBaneCode = "86165817";
const heroAllyCode = "861658170";
const nonHeroAllyCode = "861658171";
const lowOpponentCode = "861658172";
const highOpponentCode = "861658173";
const postLockTargetCode = "861658174";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasMaliciousBaneScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${maliciousBaneCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const setHero = 0x8;
const setEvilHero = 0x6008;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasMaliciousBaneScript)("Lua real script Evil HERO Malicious Bane destroy attack lock stat", () => {
  it("restores operated opponent group destruction into HERO-only attack-announcement lock and ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${maliciousBaneCode}.lua`);
    expectScriptShape(script);

    const maliciousBaneData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === maliciousBaneCode);
    expect(maliciousBaneData).toBeDefined();
    const cards: DuelCardData[] = [
      maliciousBaneData!,
      { code: heroAllyCode, name: "Malicious Bane HERO Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1000, setcodes: [setHero] },
      { code: nonHeroAllyCode, name: "Malicious Bane Non-HERO Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
      { code: lowOpponentCode, name: "Malicious Bane Low Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2200, defense: 1000 },
      { code: highOpponentCode, name: "Malicious Bane High Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 3600, defense: 1000 },
      { code: postLockTargetCode, name: "Malicious Bane Post-Lock Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 86165817, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [heroAllyCode, nonHeroAllyCode], extra: [maliciousBaneCode] }, 1: { main: [lowOpponentCode, highOpponentCode, postLockTargetCode] } });
    startDuel(session);

    const maliciousBane = requireCard(session, maliciousBaneCode);
    const heroAlly = requireCard(session, heroAllyCode);
    const nonHeroAlly = requireCard(session, nonHeroAllyCode);
    const lowOpponent = requireCard(session, lowOpponentCode, 1);
    const highOpponent = requireCard(session, highOpponentCode, 1);
    const postLockTarget = requireCard(session, postLockTargetCode, 1);
    moveFaceUpAttack(session, maliciousBane, 0).summonType = "fusion";
    moveFaceUpAttack(session, heroAlly, 0);
    moveFaceUpAttack(session, nonHeroAlly, 0);
    moveFaceUpAttack(session, lowOpponent, 1);
    moveFaceUpAttack(session, highOpponent, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(maliciousBaneCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(maliciousBane.data.fusionRequiredMaterialPredicates).toEqual([{ setcode: setEvilHero }, { levelMin: 5 }]);
    expect(session.state.effects.filter((effect) => effect.sourceUid === maliciousBane.uid && [41, 42].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { code: 42, property: 0x20000, range: ["monsterZone"], value: 1 },
      { code: 41, property: 0x20000, range: ["monsterZone"], value: 1 },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === maliciousBane.uid)?.data.fusionRequiredMaterialPredicates).toEqual([{ setcode: setEvilHero }, { levelMin: 5 }]);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === maliciousBane.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expect(restoredResolved.session.state.chain).toEqual([]);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === lowOpponent.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: maliciousBane.uid,
      reasonEffectId: 6,
    });
    expect(restoredResolved.session.state.cards.find((card) => card.uid === highOpponent.uid)).toMatchObject({ location: "monsterZone", controller: 1, faceUp: true });
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === maliciousBane.uid), restoredResolved.session.state)).toBe((maliciousBaneData!.attack ?? 0) + 200);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === maliciousBane.uid && [41, 42, 86, 100].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 42, event: "continuous", property: 0x20000, range: ["monsterZone"], reset: undefined, targetRange: undefined, value: 1 },
      { code: 41, event: "continuous", property: 0x20000, range: ["monsterZone"], reset: undefined, targetRange: undefined, value: 1 },
      { code: 86, event: "continuous", property: 0x80, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], reset: { flags: 1073742336 }, targetRange: [4, 0], value: undefined },
      { code: 100, event: "continuous", property: undefined, range: ["monsterZone"], reset: { flags: 33492992 }, targetRange: undefined, value: 200 },
    ]);
    expect(restoredResolved.session.state.eventHistory.filter((event) => event.eventName === "destroyed").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: lowOpponent.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: maliciousBane.uid, eventReasonEffectId: 6, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);

    moveFaceUpAttack(restoredResolved.session, postLockTarget, 1);
    restoredResolved.session.state.phase = "battle";
    restoredResolved.session.state.turnPlayer = 0;
    restoredResolved.session.state.waitingFor = 0;
    const battleProbe = restoreDuelWithLuaScripts(serializeDuel(restoredResolved.session), workspace, reader);
    expectCleanRestore(battleProbe);
    expectRestoredLegalActions(battleProbe, 0);
    const battleActions = getLuaRestoreLegalActions(battleProbe, 0);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === nonHeroAlly.uid)).toBe(false);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === heroAlly.uid && action.targetUid === postLockTarget.uid)).toBe(true);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === maliciousBane.uid && action.targetUid === postLockTarget.uid)).toBe(true);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_EVIL_HERO),aux.FilterBoolFunctionEx(Card.IsLevelAbove,5))");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e3:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("e4:SetCategory(CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsAttackBelow,e:GetHandler():GetAttack()),tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,tp,0)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)");
  expect(script).toContain("e1:SetTarget(function(e,c) return not c:IsSetCard(SET_HERO) end)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("aux.RegisterClientHint(c,nil,tp,1,0,aux.Stringid(id,1))");
  expect(script).toContain("Duel.GetOperatedGroup())*200");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
