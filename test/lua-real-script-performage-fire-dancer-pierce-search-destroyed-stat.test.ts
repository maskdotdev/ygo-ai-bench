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
const fireDancerCode = "7934362";
const pierceTargetCode = "79343620";
const searchTargetCode = "79343621";
const offSetDecoyCode = "79343622";
const defenderCode = "79343623";
const statTargetCode = "79343624";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasFireDancerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${fireDancerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const attributeEarth = 0x1;
const setPerformage = 0xc6;
const effectPierce = 203;
const effectUpdateAttack = 100;
const effectFlagClientHint = 0x4000000;
const resetStandardPhaseEnd = 1107169792;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasFireDancerScript)("Lua real script Performage Fire Dancer pierce search destroyed stat", () => {
  it("restores P-zone piercing grant, summon Performage search, and destroyed ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectFireDancerScriptShape(workspace.readScript(`official/c${fireDancerCode}.lua`));
    const fireDancerData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === fireDancerCode);
    expect(fireDancerData).toBeDefined();
    const reader = createCardReader([
      fireDancerData!,
      ...fixtureCards(),
    ]);

    const restoredPierce = createRestoredPierceWindow({ reader, workspace });
    expectCleanRestore(restoredPierce);
    expectRestoredLegalActions(restoredPierce, 0);
    const pzoneFireDancer = requireCard(restoredPierce.session, fireDancerCode);
    const pierceTarget = requireCard(restoredPierce.session, pierceTargetCode);
    const defender = requireCard(restoredPierce.session, defenderCode, 1);
    const pierce = getLuaRestoreLegalActions(restoredPierce, 0).find((action) => action.type === "activateEffect" && action.uid === pzoneFireDancer.uid);
    expect(pierce, JSON.stringify(getLuaRestoreLegalActions(restoredPierce, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPierce, pierce!);
    resolveRestoredChain(restoredPierce);
    expect(restoredPierce.session.state.effects.filter((effect) => effect.sourceUid === pierceTarget.uid && effect.code === effectPierce).map((effect) => ({
      code: effect.code,
      description: effect.description,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectPierce, description: 3208, property: effectFlagClientHint, reset: { flags: resetStandardPhaseEnd }, sourceUid: pierceTarget.uid },
    ]);
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredPierce.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const battlePhase = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, battlePhase!);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === pierceTarget.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passRestoredBattle(restoredBattle);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(7400);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 600 });
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: pierceTarget.uid,
        eventPlayer: 1,
        eventValue: 600,
        eventReason: duelReason.battle,
        eventReasonCardUid: pierceTarget.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredSummon = createRestoredSummonWindow({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summonFireDancer = requireCard(restoredSummon.session, fireDancerCode);
    const summonSearchTarget = requireCard(restoredSummon.session, searchTargetCode);
    const offSetDecoy = requireCard(restoredSummon.session, offSetDecoyCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === summonFireDancer.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const search = getLuaRestoreLegalActions(restoredSearch, 0).find((action) => action.type === "activateTrigger" && action.uid === summonFireDancer.uid);
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, search!);
    resolveRestoredChain(restoredSearch);
    expect(restoredSearch.session.state.cards.find((card) => card.uid === summonSearchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: summonFireDancer.uid,
      reasonEffectId: 4,
    });
    expect(restoredSearch.session.state.cards.find((card) => card.uid === offSetDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearch.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed", "chainSolved"].includes(event.eventName))).toEqual([
      sentToHandEvent(summonSearchTarget.uid, summonFireDancer.uid, 4, 2),
      confirmedEvent(summonSearchTarget.uid, summonFireDancer.uid, 4, 2),
      sentToHandConfirmedEvent(summonSearchTarget.uid, summonFireDancer.uid, 4, 2),
      chainSolvedEvent(4, "chain-3"),
    ]);

    const restoredDestroyed = createRestoredDestroyedWindow({ reader, workspace });
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    const destroyedFireDancer = requireCardWhere(restoredDestroyed.session, fireDancerCode, (card) => card.previousLocation === "monsterZone");
    const statTarget = requireCard(restoredDestroyed.session, statTargetCode);
    const stat = getLuaRestoreLegalActions(restoredDestroyed, 0).find((action) => action.type === "activateTrigger" && action.uid === destroyedFireDancer.uid);
    expect(stat, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyed, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyed, stat!);
    resolveRestoredChain(restoredDestroyed);
    expect(currentAttack(restoredDestroyed.session.state.cards.find((card) => card.uid === statTarget.uid), restoredDestroyed.session.state)).toBe(1100);
    expect(restoredDestroyed.session.state.effects.filter((effect) => effect.sourceUid === statTarget.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x400, reset: { flags: resetEventStandard }, sourceUid: statTarget.uid, value: -500 },
    ]);
    expect(restoredDestroyed.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredPierceWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 7934362, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [fireDancerCode, pierceTargetCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  movePzone(session, requireCard(session, fireDancerCode), 0);
  moveFaceUpAttack(session, requireCard(session, pierceTargetCode), 0, 0);
  moveFaceUpDefense(session, requireCard(session, defenderCode, 1), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(fireDancerCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredSummonWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 7934363, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [fireDancerCode, searchTargetCode, offSetDecoyCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, fireDancerCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(fireDancerCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDestroyedWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 7934364, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [fireDancerCode, statTargetCode] }, 1: { main: [] } });
  startDuel(session);
  const fireDancer = moveFaceUpAttack(session, requireCard(session, fireDancerCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, statTargetCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(fireDancerCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  destroyDuelCard(session.state, fireDancer.uid, 0, duelReason.effect | duelReason.destroy, 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function fixtureCards(): DuelCardData[] {
  return [
    { code: pierceTargetCode, name: "Fire Dancer Performage Pierce Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setPerformage], race: raceSpellcaster, attribute: attributeFire, level: 4, attack: 1600, defense: 1000 },
    { code: searchTargetCode, name: "Fire Dancer Performage Search Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setPerformage], race: raceSpellcaster, attribute: attributeFire, level: 4, attack: 1200, defense: 1000 },
    { code: offSetDecoyCode, name: "Fire Dancer Off-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeFire, level: 4, attack: 1200, defense: 1000 },
    { code: defenderCode, name: "Fire Dancer Defense Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: statTargetCode, name: "Fire Dancer ATK Drop Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeFire, level: 4, attack: 1600, defense: 1000 },
  ];
}

function expectFireDancerScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Performage Fire Dancer");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_PERFORMAGE) and not c:IsHasEffect(EFFECT_PIERCE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.piercefilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e1:SetCode(EFFECT_PIERCE)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsSetCard(SET_PERFORMAGE) and c:IsMonster() and c:IsAbleToHand() and not c:IsCode(id)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e4:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,tc,1,tp,-500)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-500)");
}

function sentToHandEvent(cardUid: string, sourceUid: string, reasonEffectId: number, previousSequence: number) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string, reasonEffectId: number, previousSequence: number) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string, reasonEffectId: number, previousSequence: number) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
  };
}

function chainSolvedEvent(effectId: number, chainLinkId: string) {
  return {
    eventName: "chainSolved",
    eventCode: 1022,
    eventPlayer: 0,
    eventValue: 1,
    eventReasonPlayer: 0,
    relatedEffectId: effectId,
    eventChainDepth: 1,
    eventChainLinkId: chainLinkId,
  };
}

function movePzone(session: DuelSession, card: DuelCardInstance, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.sequence = sequence;
  moved.faceUp = true;
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpDefense";
  return moved;
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function requireCardWhere(session: DuelSession, code: string, predicate: (card: DuelCardInstance) => boolean): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && predicate(candidate));
  expect(card).toBeDefined();
  return card!;
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

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType || action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
