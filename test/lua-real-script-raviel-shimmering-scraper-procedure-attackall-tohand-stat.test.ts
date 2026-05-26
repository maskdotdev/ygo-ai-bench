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
const scraperCode = "28651380";
const ravielCode = "69890967";
const releaseACode = "286513800";
const releaseBCode = "286513801";
const releaseCCode = "286513802";
const graveReleaseCode = "286513803";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasScraperScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${scraperCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpecialSummon = 0x2000000;
const raceFiend = 0x8;
const attributeDark = 0x20;
const effectSetAttackFinal = 102;
const effectAttackAll = 193;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasScraperScript)("Lua real script Raviel Shimmering Scraper procedure attack-all to-hand stat", () => {
  it("restores release procedure, hand discard double-ATK attack-all, and grave release return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScraperScriptShape(workspace.readScript(`official/c${scraperCode}.lua`));
    const reader = createCardReader(cards());

    const restoredProcedure = createRestoredProcedure({ reader, workspace });
    expectCleanRestore(restoredProcedure);
    expectRestoredLegalActions(restoredProcedure, 0);
    const procedureScraper = requireCard(restoredProcedure.session, scraperCode);
    const releaseA = requireCard(restoredProcedure.session, releaseACode);
    const releaseB = requireCard(restoredProcedure.session, releaseBCode);
    const releaseC = requireCard(restoredProcedure.session, releaseCCode);
    expect(restoredProcedure.session.state.effects.filter((effect) => effect.sourceUid === procedureScraper.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", id: "lua-1-31", property: 0x40400, range: ["hand"], triggerEvent: undefined, value: undefined },
      { category: undefined, code: 30, countLimit: undefined, event: "continuous", id: "lua-2-30", property: 0x40400, range: ["hand"], triggerEvent: undefined, value: undefined },
      { category: undefined, code: 34, countLimit: undefined, event: "summonProcedure", id: "lua-3-34", property: 0x40000, range: ["hand"], triggerEvent: undefined, value: undefined },
      { category: 0x200000, code: 1002, countLimit: 1, event: "quick", id: "lua-4-1002", property: 0x4010, range: ["hand"], triggerEvent: undefined, value: undefined },
      { category: 0x8, code: undefined, countLimit: 1, event: "ignition", id: "lua-5", property: undefined, range: ["graveyard"], triggerEvent: undefined, value: undefined },
    ]);
    const procedure = getLuaRestoreLegalActions(restoredProcedure, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === procedureScraper.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedure, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProcedure, procedure!);
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === procedureScraper.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
    });
    for (const material of [releaseA, releaseB, releaseC]) {
      expect(restoredProcedure.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "graveyard",
        controller: 0,
        reason: duelReason.cost | duelReason.release,
        reasonPlayer: 0,
        reasonCardUid: procedureScraper.uid,
        reasonEffectId: 3,
      });
    }
    expect(restoredProcedure.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard", "specialSummoned"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
      previous: event.eventPreviousState?.location,
    }))).toEqual([
      { current: "graveyard", eventCardUid: releaseA.uid, eventCode: 1017, eventName: "released", eventReason: duelReason.cost | duelReason.release, eventReasonCardUid: procedureScraper.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, eventUids: undefined, previous: "monsterZone" },
      { current: "graveyard", eventCardUid: releaseA.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost | duelReason.release, eventReasonCardUid: procedureScraper.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, eventUids: undefined, previous: "monsterZone" },
      { current: "graveyard", eventCardUid: releaseB.uid, eventCode: 1017, eventName: "released", eventReason: duelReason.cost | duelReason.release, eventReasonCardUid: procedureScraper.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, eventUids: undefined, previous: "monsterZone" },
      { current: "graveyard", eventCardUid: releaseB.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost | duelReason.release, eventReasonCardUid: procedureScraper.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, eventUids: undefined, previous: "monsterZone" },
      { current: "graveyard", eventCardUid: releaseC.uid, eventCode: 1017, eventName: "released", eventReason: duelReason.cost | duelReason.release, eventReasonCardUid: procedureScraper.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, eventUids: undefined, previous: "monsterZone" },
      { current: "graveyard", eventCardUid: releaseC.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost | duelReason.release, eventReasonCardUid: procedureScraper.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, eventUids: undefined, previous: "monsterZone" },
      { current: "graveyard", eventCardUid: releaseA.uid, eventCode: 1017, eventName: "released", eventReason: duelReason.cost | duelReason.release, eventReasonCardUid: procedureScraper.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, eventUids: [releaseA.uid, releaseB.uid, releaseC.uid], previous: "monsterZone" },
      { current: "monsterZone", eventCardUid: procedureScraper.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined, previous: "hand" },
    ]);

    const restoredHandQuick = createRestoredHandQuick({ reader, workspace });
    expectCleanRestore(restoredHandQuick);
    expectRestoredLegalActions(restoredHandQuick, 0);
    const handScraper = requireCard(restoredHandQuick.session, scraperCode);
    const raviel = requireCard(restoredHandQuick.session, ravielCode);
    const doubleAttack = getLuaRestoreLegalActions(restoredHandQuick, 0).find((action) => action.type === "activateEffect" && action.uid === handScraper.uid && action.effectId === "lua-4-1002");
    expect(doubleAttack, JSON.stringify(getLuaRestoreLegalActions(restoredHandQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredHandQuick, doubleAttack!);
    resolveRestoredChain(restoredHandQuick);
    expect(restoredHandQuick.session.state.cards.find((card) => card.uid === handScraper.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: handScraper.uid,
      reasonEffectId: 4,
    });
    expect(currentAttack(restoredHandQuick.session.state.cards.find((card) => card.uid === raviel.uid), restoredHandQuick.session.state)).toBe(8000);
    expect(restoredHandQuick.session.state.effects.filter((effect) => effect.sourceUid === raviel.uid && [effectSetAttackFinal, effectAttackAll].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: 0x400, reset: { flags: resetStandardPhaseEnd }, sourceUid: raviel.uid, value: 8000 },
      { code: effectAttackAll, property: undefined, reset: { flags: resetStandardPhaseEnd }, sourceUid: raviel.uid, value: 1 },
    ]);
    expect(restoredHandQuick.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { current: "graveyard", eventCardUid: handScraper.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost | duelReason.discard, eventReasonCardUid: handScraper.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "hand", relatedEffectId: undefined },
      { current: "monsterZone", eventCardUid: raviel.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", relatedEffectId: 4 },
    ]);

    const restoredGrave = createRestoredGraveReturn({ reader, workspace });
    expectCleanRestore(restoredGrave);
    expectRestoredLegalActions(restoredGrave, 0);
    const graveScraper = requireCard(restoredGrave.session, scraperCode);
    const graveRelease = requireCard(restoredGrave.session, graveReleaseCode);
    const returnToHand = getLuaRestoreLegalActions(restoredGrave, 0).find((action) => action.type === "activateEffect" && action.uid === graveScraper.uid && action.effectId === "lua-5");
    expect(returnToHand, JSON.stringify(getLuaRestoreLegalActions(restoredGrave, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredGrave, returnToHand!);
    resolveRestoredChain(restoredGrave);
    expect(restoredGrave.session.state.cards.find((card) => card.uid === graveRelease.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: graveScraper.uid,
      reasonEffectId: 5,
    });
    expect(restoredGrave.session.state.cards.find((card) => card.uid === graveScraper.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveScraper.uid,
      reasonEffectId: 5,
    });
    expect(restoredGrave.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard", "sentToHand"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
    }))).toEqual([
      { current: "graveyard", eventCardUid: graveRelease.uid, eventCode: 1017, eventName: "released", eventReason: duelReason.cost | duelReason.release, eventReasonCardUid: graveScraper.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, previous: "monsterZone" },
      { current: "graveyard", eventCardUid: graveRelease.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost | duelReason.release, eventReasonCardUid: graveScraper.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, previous: "monsterZone" },
      { current: "hand", eventCardUid: graveScraper.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: graveScraper.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, previous: "graveyard" },
    ]);
    expect(restoredGrave.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredProcedure({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 28651380, reader, workspace, main0: [scraperCode, releaseACode, releaseBCode, releaseCCode], main1: [] });
  moveDuelCard(session.state, requireCard(session, scraperCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, releaseACode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, releaseBCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, releaseCCode), 0, 2);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredHandQuick({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 28651381, reader, workspace, main0: [scraperCode, ravielCode], main1: [] });
  moveDuelCard(session.state, requireCard(session, scraperCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, ravielCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredGraveReturn({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 28651382, reader, workspace, main0: [scraperCode, graveReleaseCode], main1: [] });
  moveDuelCard(session.state, requireCard(session, scraperCode).uid, "graveyard", 0);
  moveFaceUpAttack(session, requireCard(session, graveReleaseCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createBaseSession({
  seed,
  reader,
  workspace,
  main0,
  main1,
}: {
  seed: number;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  main0: string[];
  main1: string[];
}): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: main0 }, 1: { main: main1 } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(scraperCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectScraperScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("s.listed_names={69890967}");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e1:SetValue(aux.FALSE)");
  expect(script).toContain("e2:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("Duel.GetReleaseGroup(tp)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("e3:SetCost(Cost.SelfDiscard)");
  expect(script).toContain("e3:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("return c:IsFaceup() and c:IsCode(69890967)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()*2)");
  expect(script).toContain("e2:SetCode(EFFECT_ATTACK_ALL)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,nil,1,false,nil,nil)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,nil,1,1,false,nil,nil)");
  expect(script).toContain("Duel.SendtoHand(e:GetHandler(),nil,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: scraperCode, name: "Raviel, Lord of Phantasms - Shimmering Scraper", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpecialSummon, race: raceFiend, attribute: attributeDark, level: 10, attack: 4000, defense: 4000 },
    { code: ravielCode, name: "Raviel, Lord of Phantasms", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpecialSummon, race: raceFiend, attribute: attributeDark, level: 10, attack: 4000, defense: 4000 },
    { code: releaseACode, name: "Shimmering Scraper Release A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: releaseBCode, name: "Shimmering Scraper Release B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1100, defense: 1000 },
    { code: releaseCCode, name: "Shimmering Scraper Release C", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: graveReleaseCode, name: "Shimmering Scraper Grave Release", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1300, defense: 1000 },
  ];
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
