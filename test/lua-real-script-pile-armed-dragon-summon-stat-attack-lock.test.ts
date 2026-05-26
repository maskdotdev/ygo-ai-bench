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
const pileCode = "19153590";
const summonCostCode = "191535900";
const armedCostCode = "191535901";
const allyCode = "191535902";
const defenderACode = "191535903";
const defenderBCode = "191535904";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasPileScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${pileCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceDragon = 0x2000;
const attributeWind = 0x8;
const attributeFire = 0x4;
const setArmedDragon = 0x111;
const effectCannotAttackAnnounce = 86;
const effectUpdateAttack = 100;
const eventAttackAnnounce = 1130;
const effectFlagCannotDisable = 0x400;
const effectFlagClientHintIgnoreImmune = 0x4000080;
const resetPhaseEnd = 0x40000200;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPileScript)("Lua real script Pile Armed Dragon summon stat attack lock", () => {
  it("restores hand Dragon cost self-summon and Armed Dragon cost ATK boost into single-attacker lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${pileCode}.lua`));
    const databasePile = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === pileCode);
    expect(databasePile).toBeDefined();
    const reader = createCardReader([
      databasePile!,
      ...cards(),
    ]);

    const restoredSummon = createRestoredSummonWindow({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const handPile = requireCard(restoredSummon.session, pileCode);
    const summonCost = requireCard(restoredSummon.session, summonCostCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handPile.uid && action.effectId === "lua-1"
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    resolveRestoredChain(restoredSummon);
    expect(restoredSummon.session.state.cards.find((card) => card.uid === summonCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: handPile.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.cards.find((card) => card.uid === handPile.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: handPile.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: summonCost.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: handPile.uid, eventReasonEffectId: 1, previous: "hand", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: handPile.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: handPile.uid, eventReasonEffectId: 1, previous: "hand", current: "monsterZone" },
    ]);

    const restoredStat = createRestoredStatLockWindow({ reader, workspace });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const fieldPile = requireCard(restoredStat.session, pileCode);
    const armedCost = requireCard(restoredStat.session, armedCostCode);
    const ally = requireCard(restoredStat.session, allyCode);
    const defenderA = requireCard(restoredStat.session, defenderACode);
    const defenderB = requireCard(restoredStat.session, defenderBCode);
    const stat = getLuaRestoreLegalActions(restoredStat, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fieldPile.uid && action.effectId === "lua-2"
    );
    expect(stat, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, stat!);
    resolveRestoredChain(restoredStat);
    expect(restoredStat.session.state.cards.find((card) => card.uid === armedCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: fieldPile.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === fieldPile.uid), restoredStat.session.state)).toBe(4900);
    expect(restoredStat.session.state.effects.filter((effect) =>
      effect.sourceUid === fieldPile.uid && [effectUpdateAttack, effectCannotAttackAnnounce, eventAttackAnnounce].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      labelObjectId: effect.labelObjectId,
      property: effect.property,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", labelObjectId: undefined, property: undefined, registryKey: `lua:${pileCode}:lua-3-100`, reset: { flags: resetStandardPhaseEnd }, sourceUid: fieldPile.uid, targetRange: undefined, value: 2100 },
      { code: effectCannotAttackAnnounce, event: "continuous", labelObjectId: undefined, property: effectFlagClientHintIgnoreImmune, registryKey: `lua:${pileCode}:lua-4-86`, reset: { flags: resetPhaseEnd }, sourceUid: fieldPile.uid, targetRange: [4, 0], value: undefined },
      { code: eventAttackAnnounce, event: "continuous", labelObjectId: 4, property: effectFlagCannotDisable, registryKey: `lua:${pileCode}:lua-5-1130`, reset: { flags: resetPhaseEnd }, sourceUid: fieldPile.uid, targetRange: undefined, value: undefined },
    ]);
    const battle = getLuaRestoreLegalActions(restoredStat, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, battle!);
    const attack = getLuaRestoreLegalActions(restoredStat, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === fieldPile.uid && action.targetUid === defenderA.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, attack!);
    passBattleResponses(restoredStat);
    const postAttackActions = getLuaRestoreLegalActions(restoredStat, 0);
    expect(postAttackActions.some((action) => action.type === "declareAttack" && action.attackerUid === ally.uid && action.targetUid === defenderB.uid)).toBe(false);
    expect(restoredStat.session.state.cards.find((card) => card.uid === defenderA.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: fieldPile.uid,
    });
    expect(restoredStat.session.state.cards.find((card) => card.uid === defenderB.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredStat.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard", "attackDeclared"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: armedCost.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: fieldPile.uid, eventReasonEffectId: 2, previous: "deck", current: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: fieldPile.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "attackDeclared", eventCode: eventAttackAnnounce, eventCardUid: fieldPile.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: defenderA.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: fieldPile.uid, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard" },
    ]);
    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredStat.session), workspace, reader);
    expectCleanRestore(restoredPersistent);
    expectRestoredLegalActions(restoredPersistent, 0);
    expect(currentAttack(restoredPersistent.session.state.cards.find((card) => card.uid === fieldPile.uid), restoredPersistent.session.state)).toBe(4900);
    expect(restoredPersistent.session.state.battleDamage).toEqual({ 0: 0, 1: 3900 });
  });
});

function createRestoredSummonWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 19153590, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [pileCode, summonCostCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, pileCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, summonCostCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(pileCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredStatLockWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 19153591, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [pileCode, armedCostCode, allyCode] }, 1: { main: [defenderACode, defenderBCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, pileCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, defenderACode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, defenderBCode), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(pileCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Pile Armed Dragon");
  expect(script).toContain("s.listed_series={SET_ARMED_DRAGON}");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter1,tp,LOCATION_HAND,0,1,1,e:GetHandler())");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter2,tp,LOCATION_HAND|LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("local atk=g:GetFirst():GetLevel()*300");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e3:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("Duel.RegisterEffect(e2,tp)");
  expect(script).toContain("Duel.RegisterEffect(e3,tp)");
}

function cards(): DuelCardData[] {
  return [
    { code: summonCostCode, name: "Pile Armed Dragon WIND Dragon Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
    { code: armedCostCode, name: "Pile Armed Dragon Level 7 Armed Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeWind, level: 7, attack: 2400, defense: 1000, setcodes: [setArmedDragon] },
    { code: allyCode, name: "Pile Armed Dragon Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeFire, level: 4, attack: 1800, defense: 1000 },
    { code: defenderACode, name: "Pile Armed Dragon Defender A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
    { code: defenderBCode, name: "Pile Armed Dragon Defender B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string, controller?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.controller === controller));
  expect(card).toBeDefined();
  return card!;
}

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
