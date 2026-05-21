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
const timaeusCode = "85899505";
const battleTargetCode = "858995050";
const ownSpellCode = "858995051";
const banishedSpellCode = "858995052";
const ownTrapCode = "858995053";
const opponentSpellCode = "858995054";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTimaeusScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${timaeusCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeFusion = 0x40;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const raceSpellcaster = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasTimaeusScript)("Lua real script Timaeus United immunity stat destroy", () => {
  it("restores pre-damage Spell count ATK gain and opponent-turn Spell/Trap destroy with summon-immunity script coverage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${timaeusCode}.lua`);
    expect(script).toContain("Fusion.AddProcMix(c,true,true,{CARD_DARK_MAGICIAN,CARD_DARK_MAGICIAN_GIRL},aux.FilterBoolFunctionEx(Card.IsRace,RACE_DRAGON|RACE_SPELLCASTER))");
    expect(script).toContain("e0:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e1:SetCode(EFFECT_IMMUNE_EFFECT)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CLIENT_HINT)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END,ct)");
    expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsSpell),tp,LOCATION_GRAVE|LOCATION_REMOVED,LOCATION_GRAVE|LOCATION_REMOVED,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,e:GetHandler(),1,tp,100*ct)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(100*ct)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e2:SetCondition(function(e,tp) return Duel.IsTurnPlayer(1-tp) end)");
    expect(script).toContain("Duel.IsExistingTarget(Card.IsSpellTrap,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsSpellTrap,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,tp,0)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 85899505, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ownSpellCode, banishedSpellCode, ownTrapCode], extra: [timaeusCode] }, 1: { main: [battleTargetCode, opponentSpellCode] } });
    startDuel(session);
    const timaeus = requireCard(session, timaeusCode);
    const battleTarget = requireCard(session, battleTargetCode);
    const ownSpell = requireCard(session, ownSpellCode);
    const banishedSpell = requireCard(session, banishedSpellCode);
    const ownTrap = requireCard(session, ownTrapCode);
    const opponentSpell = requireCard(session, opponentSpellCode);

    moveFaceUpAttack(session, timaeus, 0);
    timaeus.summonType = "fusion";
    moveFaceUpAttack(session, battleTarget, 1);
    moveFaceUpSpell(session, ownTrap, 0);
    moveFaceUpSpell(session, opponentSpell, 1);
    moveFaceUpSpell(session, ownSpell, 0);
    moveDuelCard(session.state, ownSpell.uid, "graveyard", 0).faceUp = true;
    moveFaceUpSpell(session, banishedSpell, 0);
    moveDuelCard(session.state, banishedSpell.uid, "banished", 0).faceUp = true;
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(timaeusCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);

    const attack = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "declareAttack" && action.attackerUid === timaeus.uid && action.targetUid === battleTarget.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummon, attack!);
    passBattleUntilTrigger(restoredSummon);
    const statTrigger = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "activateTrigger" && action.uid === timaeus.uid);
    expect(statTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(statTrigger)).not.toContain("operationInfos");
    applyLuaRestoreAndAssert(restoredSummon, statTrigger!);
    passRestoredChain(restoredSummon);
    expect(currentAttack(restoredSummon.session.state.cards.find((card) => card.uid === timaeus.uid), restoredSummon.session.state)).toBe(3000);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === timaeus.uid && effect.code === 100).map((effect) => ({
      sourceUid: effect.sourceUid,
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { sourceUid: timaeus.uid, code: 100, event: "continuous", reset: { flags: 33492992 }, value: 200 },
    ]);

    const restoredQuick = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredQuick);
    restoredQuick.session.state.phase = "main1";
    restoredQuick.session.state.turnPlayer = 1;
    restoredQuick.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredQuick, 0);
    const quick = getLuaRestoreLegalActions(restoredQuick, 0).find((action) => action.type === "activateEffect" && action.uid === timaeus.uid);
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(quick)).not.toContain("operationInfos");
    applyLuaRestoreAndAssert(restoredQuick, quick!);
    passRestoredChain(restoredQuick);

    expect(restoredQuick.session.state.cards.find((card) => card.uid === ownTrap.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: timaeus.uid,
      reasonEffectId: 4,
    });
    expect(restoredQuick.session.state.cards.find((card) => card.uid === opponentSpell.uid)).toMatchObject({ location: "spellTrapZone", controller: 1 });
    expect(restoredQuick.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: ownTrap.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4, previousLocation: "deck", currentLocation: "spellTrapZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: ownTrap.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: timaeus.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: ownTrap.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: timaeus.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: timaeusCode, name: "Timaeus the United Magical Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceDragon, level: 8, attack: 2800, defense: 1800 },
    { code: battleTargetCode, name: "Timaeus Battle Target", kind: "monster", typeFlags: typeMonster, race: raceSpellcaster, level: 4, attack: 1600, defense: 1000 },
    { code: ownSpellCode, name: "Timaeus Grave Spell", kind: "spell", typeFlags: typeSpell },
    { code: banishedSpellCode, name: "Timaeus Banished Spell", kind: "spell", typeFlags: typeSpell },
    { code: ownTrapCode, name: "Timaeus Own Trap Target", kind: "trap", typeFlags: typeTrap },
    { code: opponentSpellCode, name: "Timaeus Opponent Spell Survivor", kind: "spell", typeFlags: typeSpell },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
