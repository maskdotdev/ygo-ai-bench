import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const melusineCode = "32138660";
const reptileTunerCode = "321386600";
const reptileNonTunerCode = "321386601";
const chainStarterCode = "321386602";
const attackTargetCode = "321386603";
const searchTargetCode = "321386604";
const offRaceDecoyCode = "321386605";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasMelusineScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${melusineCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const typeTuner = 0x1000;
const raceReptile = 0x80000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectIndestructibleEffect = 41;
const effectIndestructibleBattle = 42;
const effectSetAttackFinal = 102;
const effectFlagSingleRange = 0x20000;
const effectFlagClientHint = 0x4000000;
const resetMelusineMaterialFlag = 0x7e1000;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasMelusineScript)("Lua real script Reptilianne Melusine synchro protect chain zero search stat", () => {
  it("restores Reptile Synchro material protection, opponent-chain ATK zero, and opponent to-grave search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectMelusineScriptShape(workspace.readScript(`official/c${melusineCode}.lua`));
    const melusineData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === melusineCode);
    expect(melusineData).toBeDefined();
    const reader = createCardReader([
      melusineData!,
      ...fixtureCards(),
    ]);
    const source = sourceWithChainStarter(workspace);

    const restoredSummon = createRestoredSynchroWindow({ reader, source, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summonedMelusine = requireCard(restoredSummon.session, melusineCode);
    const tuner = requireCard(restoredSummon.session, reptileTunerCode);
    const nonTuner = requireCard(restoredSummon.session, reptileNonTunerCode);
    const synchro = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "synchroSummon" && action.uid === summonedMelusine.uid && action.materialUids.includes(tuner.uid) && action.materialUids.includes(nonTuner.uid)
    );
    expect(synchro, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, synchro!);
    const restoredProtected = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), source, reader);
    expectCleanRestore(restoredProtected);
    expectRestoredLegalActions(restoredProtected, 0);
    expect(restoredProtected.session.state.cards.find((card) => card.uid === summonedMelusine.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "synchro",
      summonMaterialUids: [tuner.uid, nonTuner.uid],
    });
    expect(restoredProtected.session.state.flagEffects.filter((flag) => flag.ownerType === "card" && flag.ownerId === summonedMelusine.uid && flag.code === Number(melusineCode)).map((flag) => ({
      code: flag.code,
      property: flag.property,
      reset: flag.reset,
      value: flag.value,
    }))).toEqual([
      { code: Number(melusineCode), property: effectFlagClientHint, reset: resetMelusineMaterialFlag, value: 0 },
    ]);
    expect(restoredProtected.session.state.effects.filter((effect) => effect.sourceUid === summonedMelusine.uid && [effectIndestructibleBattle, effectIndestructibleEffect].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectIndestructibleBattle, event: "continuous", property: effectFlagSingleRange, range: ["monsterZone"], sourceUid: summonedMelusine.uid, value: 1 },
      { code: effectIndestructibleEffect, event: "continuous", property: effectFlagSingleRange, range: ["monsterZone"], sourceUid: summonedMelusine.uid, value: 1 },
    ]);
    expect(destroyDuelCard(restoredProtected.session.state, summonedMelusine.uid, 0, duelReason.battle | duelReason.destroy, 1)).toMatchObject({
      uid: summonedMelusine.uid,
      location: "monsterZone",
      controller: 0,
    });
    expect(destroyDuelCard(restoredProtected.session.state, summonedMelusine.uid, 0, duelReason.effect | duelReason.destroy, 1)).toMatchObject({
      uid: summonedMelusine.uid,
      location: "monsterZone",
      controller: 0,
    });

    const restoredChain = createRestoredChainWindow({ reader, source, workspace });
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    const chainMelusine = requireCard(restoredChain.session, melusineCode);
    const chainStarter = requireCard(restoredChain.session, chainStarterCode);
    const attackTarget = requireCard(restoredChain.session, attackTargetCode);
    const starter = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "activateEffect" && action.uid === chainStarter.uid);
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChain, starter!);
    expectRestoredLegalActions(restoredChain, 0);
    const zero = getLuaRestoreLegalActions(restoredChain, 0).find((action) => action.type === "activateEffect" && action.uid === chainMelusine.uid);
    expect(zero, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChain, zero!);
    resolveRestoredChain(restoredChain);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === attackTarget.uid), restoredChain.session.state)).toBe(0);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === attackTarget.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", reset: { flags: resetEventStandard }, sourceUid: attackTarget.uid, value: 0 },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["becameTarget", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 2,
        eventCardUid: attackTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 6,
        eventChainDepth: 2,
        eventChainLinkId: "chain-3",
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      chainSolvedEvent(6, "chain-3", 2, 0, 2),
      chainSolvedEvent(8, "chain-2", 1, 1, 1),
    ]);

    const restoredGraveOpen = createRestoredSearchWindow({ reader, source, workspace });
    expectCleanRestore(restoredGraveOpen);
    expectRestoredLegalActions(restoredGraveOpen, 0);
    const graveMelusine = requireCard(restoredGraveOpen.session, melusineCode);
    const searchTarget = requireCard(restoredGraveOpen.session, searchTargetCode);
    const offRaceDecoy = requireCard(restoredGraveOpen.session, offRaceDecoyCode);
    sendDuelCardToGraveyard(restoredGraveOpen.session.state, graveMelusine.uid, 0, duelReason.effect, 1);
    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(restoredGraveOpen.session), source, reader);
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    expect(restoredSearch.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-7-1014", eventCardUid: graveMelusine.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonPlayer: 1, player: 0, sourceUid: graveMelusine.uid, triggerBucket: "turnOptional" },
    ]);
    const search = getLuaRestoreLegalActions(restoredSearch, 0).find((action) => action.type === "activateTrigger" && action.uid === graveMelusine.uid);
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, search!);
    resolveRestoredChain(restoredSearch);
    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveMelusine.uid,
      reasonEffectId: 7,
    });
    expect(restoredSearch.session.state.cards.find((card) => card.uid === offRaceDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearch.session.state.eventHistory.filter((event) => ["sentToGraveyard", "sentToHand", "confirmed", "sentToHandConfirmed", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: graveMelusine.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      sentToHandEvent(searchTarget.uid, graveMelusine.uid, 7, 2),
      confirmedEvent(searchTarget.uid, graveMelusine.uid, 7, 2),
      sentToHandConfirmedEvent(searchTarget.uid, graveMelusine.uid, 7, 2),
      chainSolvedEvent(7, "chain-3", 1),
    ]);
    expect(restoredSearch.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredSynchroWindow({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ReturnType<typeof sourceWithChainStarter>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 32138660, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [reptileTunerCode, reptileNonTunerCode], extra: [melusineCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, reptileTunerCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, reptileNonTunerCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerScripts(session, source, workspace, false);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function createRestoredChainWindow({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ReturnType<typeof sourceWithChainStarter>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 32138661, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [melusineCode] }, 1: { main: [chainStarterCode, attackTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, melusineCode), 0, 0).summonType = "synchro";
  moveFaceUpAttack(session, requireCard(session, chainStarterCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, attackTargetCode), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  registerScripts(session, source, workspace, true);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function createRestoredSearchWindow({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ReturnType<typeof sourceWithChainStarter>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 32138662, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [melusineCode, searchTargetCode, offRaceDecoyCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, melusineCode), 0, 0).summonType = "synchro";
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerScripts(session, source, workspace, false);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function fixtureCards(): DuelCardData[] {
  return [
    { code: reptileTunerCode, name: "Melusine Reptile Tuner", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceReptile, attribute: attributeDark, level: 3, attack: 1000, defense: 1000 },
    { code: reptileNonTunerCode, name: "Melusine Reptile Non-Tuner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, level: 5, attack: 1500, defense: 1200 },
    { code: chainStarterCode, name: "Melusine Opponent Chain Starter", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 0, defense: 1000 },
    { code: attackTargetCode, name: "Melusine Opponent ATK Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    { code: searchTargetCode, name: "Melusine Reptile Search Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: offRaceDecoyCode, name: "Melusine Off-Race Search Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1400, defense: 1000 },
  ];
}

function sourceWithChainStarter(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${chainStarterCode}.lua`) return chainStarterScript();
      return workspace.readScript(name);
    },
  };
}

function chainStarterScript(): string {
  return `
local s,id=GetID()
function s.initial_effect(c)
  local e1=Effect.CreateEffect(c)
  e1:SetDescription(0)
  e1:SetType(EFFECT_TYPE_QUICK_O)
  e1:SetCode(EVENT_FREE_CHAIN)
  e1:SetRange(LOCATION_MZONE)
  e1:SetOperation(function(e,tp,eg,ep,ev,re,r,rp) end)
  c:RegisterEffect(e1)
end
`;
}

function registerScripts(
  session: DuelSession,
  source: ReturnType<typeof sourceWithChainStarter>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  includeChainStarter: boolean,
): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(melusineCode), source).ok).toBe(true);
  if (includeChainStarter) expect(host.loadCardScript(Number(chainStarterCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(includeChainStarter ? 2 : 1);
}

function expectMelusineScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Reptilianne Melusine");
  expect(script).toContain("Synchro.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_REPTILE),1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("e0:SetCode(EFFECT_MATERIAL_CHECK)");
  expect(script).toContain("c:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD&~(RESET_TOFIELD|RESET_LEAVE),EFFECT_FLAG_CLIENT_HINT,1,0,aux.Stringid(id,2))");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("return c:IsSynchroSummoned() and c:HasFlagEffect(id)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e3:SetCode(EVENT_CHAINING)");
  expect(script).toContain("return rp==1-tp and re:IsMonsterEffect()");
  expect(script).toContain("Duel.SelectTarget(tp,Card.HasNonZeroAttack,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("e4:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return rp==1-tp and c:IsPreviousControler(tp) and c:IsPreviousLocation(LOCATION_MZONE)");
  expect(script).toContain("return c:IsRace(RACE_REPTILE) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
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

function chainSolvedEvent(effectId: number, chainLinkId: string, eventChainDepth: number, eventPlayer = 0, eventValue = 1) {
  return {
    eventName: "chainSolved",
    eventCode: 1022,
    eventPlayer,
    eventValue,
    eventReasonPlayer: eventPlayer,
    relatedEffectId: effectId,
    eventChainDepth,
    eventChainLinkId: chainLinkId,
  };
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
