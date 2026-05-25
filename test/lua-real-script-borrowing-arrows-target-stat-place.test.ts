import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const arrowsCode = "33609093";
const ownWarriorCode = "336090930";
const secondWarriorCode = "336090931";
const opponentCode = "336090932";
const placeContinuousCode = "336090933";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasArrowsScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${arrowsCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const raceBeastWarrior = 0x400000;
const attributeFire = 0x4;
const attributeWind = 0x10;
const attributeDark = 0x20;
const setAncientWarriors = 0x137;
const effectSetAttackFinal = 102;
const effectUpdateAttack = 100;
const effectFlagCannotDisable = 0x400;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasArrowsScript)("Lua real script Borrowing of Arrows target stat place", () => {
  it("restores targeted ATK transfer and delayed Ancient Warriors continuous placement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${arrowsCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const statSession = createDuel({ seed: 33609093, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(statSession, { 0: { main: [arrowsCode, ownWarriorCode] }, 1: { main: [opponentCode] } });
    startDuel(statSession);
    const statArrows = requireCard(statSession, arrowsCode);
    const ownWarrior = requireCard(statSession, ownWarriorCode);
    const opponent = requireCard(statSession, opponentCode);
    moveFaceUpSpellTrap(statSession, statArrows, 0, 0);
    moveFaceUpAttack(statSession, ownWarrior, 0, 0);
    moveFaceUpAttack(statSession, opponent, 1, 0);
    statSession.state.phase = "main1";
    statSession.state.turnPlayer = 0;
    statSession.state.waitingFor = 0;

    const statHost = createLuaScriptHost(statSession, workspace);
    expect(statHost.loadCardScript(Number(arrowsCode), workspace).ok).toBe(true);
    expect(statHost.registerInitialEffects()).toBe(1);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(statSession), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const transfer = getLuaRestoreLegalActions(restoredStat, 0).find((action) =>
      action.type === "activateEffect" && action.uid === statArrows.uid && action.effectId === "lua-2"
    );
    expect(transfer, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, transfer!);
    resolveRestoredChain(restoredStat);

    expect(currentAttack(findCard(restoredStat.session, opponent.uid), restoredStat.session.state)).toBe(1200);
    expect(currentAttack(findCard(restoredStat.session, ownWarrior.uid), restoredStat.session.state)).toBe(3000);
    expect(restoredStat.session.state.effects.filter((effect) =>
      [effectSetAttackFinal, effectUpdateAttack].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    })).sort((left, right) => (left.code ?? 0) - (right.code ?? 0))).toEqual([
      { code: effectUpdateAttack, property: effectFlagCannotDisable, reset: { flags: resetStandardPhaseEnd }, sourceUid: ownWarrior.uid, value: 1200 },
      { code: effectSetAttackFinal, property: undefined, reset: { flags: resetStandardPhaseEnd }, sourceUid: opponent.uid, value: 1200 },
    ]);
    expect(restoredStat.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: opponent.uid, eventCode: 1028, eventName: "becameTarget", relatedEffectId: 2 },
      { eventCardUid: ownWarrior.uid, eventCode: 1028, eventName: "becameTarget", relatedEffectId: 2 },
    ]);

    const placeSession = createDuel({ seed: 33609094, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(placeSession, { 0: { main: [arrowsCode, ownWarriorCode, secondWarriorCode, placeContinuousCode] }, 1: { main: [] } });
    startDuel(placeSession);
    const placeArrows = requireCard(placeSession, arrowsCode);
    const fireWarrior = requireCard(placeSession, ownWarriorCode);
    const windWarrior = requireCard(placeSession, secondWarriorCode);
    const continuous = requireCard(placeSession, placeContinuousCode);
    moveFaceUpSpellTrap(placeSession, placeArrows, 0, 0);
    moveFaceUpAttack(placeSession, fireWarrior, 0, 0);
    moveFaceUpAttack(placeSession, windWarrior, 0, 1);
    placeSession.state.phase = "main1";
    placeSession.state.turnPlayer = 0;
    placeSession.state.waitingFor = 0;
    const placeHost = createLuaScriptHost(placeSession, workspace);
    expect(placeHost.loadCardScript(Number(arrowsCode), workspace).ok).toBe(true);
    expect(placeHost.registerInitialEffects()).toBe(1);
    destroyDuelCard(placeSession.state, placeArrows.uid, 0, duelReason.effect | duelReason.destroy, 1, "graveyard", {
      eventReasonCardUid: fireWarrior.uid,
      eventReasonEffectId: 99,
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(placeSession), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1014", eventCardUid: placeArrows.uid, eventCode: 1014, eventName: "sentToGraveyard", player: 0, sourceUid: placeArrows.uid, triggerBucket: "turnOptional" },
    ]);
    const place = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === placeArrows.uid && action.effectId === "lua-3-1014"
    );
    expect(place, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, place!);
    resolveRestoredChain(restoredTrigger);

    expect(findCard(restoredTrigger.session, continuous.uid)).toMatchObject({
      controller: 0,
      faceUp: true,
      location: "spellTrapZone",
      reason: duelReason.effect,
      reasonCardUid: placeArrows.uid,
      reasonEffectId: 3,
      reasonPlayer: 0,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard", "moved"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { current: "graveyard", eventCardUid: placeArrows.uid, eventCode: 1030, eventName: "moved", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: fireWarrior.uid, eventReasonEffectId: 99, previous: "spellTrapZone", relatedEffectId: undefined },
      { current: "graveyard", eventCardUid: placeArrows.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: fireWarrior.uid, eventReasonEffectId: 99, previous: "spellTrapZone", relatedEffectId: undefined },
      { current: "graveyard", eventCardUid: placeArrows.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: fireWarrior.uid, eventReasonEffectId: 99, previous: "spellTrapZone", relatedEffectId: undefined },
      { current: "spellTrapZone", eventCardUid: continuous.uid, eventCode: 1030, eventName: "moved", eventReason: duelReason.effect, eventReasonCardUid: placeArrows.uid, eventReasonEffectId: 3, previous: "deck", relatedEffectId: undefined },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const arrows = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === arrowsCode);
  expect(arrows).toBeDefined();
  return [
    { ...arrows!, kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setAncientWarriors] },
    { code: ownWarriorCode, name: "Borrowing Arrows Ancient Warriors FIRE", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeFire, level: 4, attack: 1800, defense: 1000, setcodes: [setAncientWarriors] },
    { code: secondWarriorCode, name: "Borrowing Arrows Ancient Warriors WIND", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeWind, level: 4, attack: 1600, defense: 1000, setcodes: [setAncientWarriors] },
    { code: opponentCode, name: "Borrowing Arrows Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 2400, defense: 1000 },
    { code: placeContinuousCode, name: "Borrowing Arrows Continuous Target", kind: "trap", typeFlags: typeTrap | typeContinuous, setcodes: [setAncientWarriors] },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Ancient Warriors Saga - Borrowing of Arrows");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsSetCard,SET_ANCIENT_WARRIORS),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("return Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_ANCIENT_WARRIORS),tp,LOCATION_MZONE,0,nil):GetClassCount(Card.GetAttribute)>1");
  expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_SZONE)>0");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK|LOCATION_HAND,0,1,1,nil,tp)");
  expect(script).toContain("Duel.MoveToField(tc,tp,tp,LOCATION_SZONE,POS_FACEUP,true)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.sequence = sequence;
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
