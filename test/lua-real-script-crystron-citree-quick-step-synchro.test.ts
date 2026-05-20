import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const citreeCode = "20050865";
const graveNonTunerCode = "200508650";
const extraSynchroCode = "200508651";
const decoySynchroCode = "200508652";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasCitreeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${citreeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const raceMachine = 0x20;
const raceDragon = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasCitreeScript)("Lua real script Crystron Citree quick step Synchro", () => {
  it("restores opponent-turn target revive through SpecialSummonStep into Lua SynchroSummon with banish redirects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${citreeCode}.lua`);
    expect(script).toContain("Duel.IsTurnPlayer(1-tp) and (Duel.IsMainPhase() or Duel.IsBattlePhase())");
    expect(script).toContain("Duel.IsPlayerCanSpecialSummonCount(tp,2)");
    expect(script).toContain("Duel.SelectTarget(tp,s.scfilter1,tp,LOCATION_GRAVE,0,1,1,nil,e,tp,e:GetHandler())");
    expect(script).toContain("Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("Duel.SpecialSummonComplete()");
    expect(script).toContain("Duel.SynchroSummon(tp,sg:GetFirst(),nil,mg)");
    expect(script).toContain("e1:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)");
    expect(script).toContain("e1:SetValue(LOCATION_REMOVED)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === citreeCode),
      { code: graveNonTunerCode, name: "Citree Level 2 Non-Tuner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 2, attack: 800, defense: 800 },
      { code: extraSynchroCode, name: "Citree Machine Synchro", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceMachine, level: 4, attack: 2200, defense: 1600 },
      { code: decoySynchroCode, name: "Citree Dragon Synchro Decoy", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceDragon, level: 4, attack: 2200, defense: 1600 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 20050865, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [citreeCode, graveNonTunerCode], extra: [decoySynchroCode, extraSynchroCode] }, 1: { main: [] } });
    startDuel(session);

    const citree = requireCard(session.state.cards, citreeCode);
    const target = requireCard(session.state.cards, graveNonTunerCode);
    const synchro = requireCard(session.state.cards, extraSynchroCode);
    const decoySynchro = requireCard(session.state.cards, decoySynchroCode);
    moveDuelCard(session.state, citree.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(citreeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(citree.data.typeFlags).toBe(typeMonster | typeEffect | typeTuner);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(getLuaRestoreLegalActions(restoredOpen, 1)).toEqual([]);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === citree.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === synchro.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "synchro",
      reason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
      reasonPlayer: 0,
      summonMaterialUids: [citree.uid, target.uid],
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === citree.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.material | duelReason.synchro | duelReason.redirect,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.material | duelReason.synchro | duelReason.redirect,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === decoySynchro.uid)).toMatchObject({ location: "extraDeck", controller: 0 });
    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.eventHistory.filter((event) => ["specialSummoned", "usedAsMaterial"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: target.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: citree.uid,
        eventReasonEffectId: 1,
        eventUids: [target.uid],
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "usedAsMaterial",
        eventCode: 1108,
        eventCardUid: citree.uid,
        eventReason: duelReason.synchro,
        eventReasonPlayer: 0,
        eventReasonCardUid: synchro.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "usedAsMaterial",
        eventCode: 1108,
        eventCardUid: target.uid,
        eventReason: duelReason.synchro,
        eventReasonPlayer: 0,
        eventReasonCardUid: synchro.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: synchro.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
        eventReasonPlayer: 0,
        eventReasonCardUid: citree.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function requireCard(cards: DuelCardInstance[], code: string): DuelCardInstance {
  const card = cards.find((candidate) => candidate.code === code);
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
