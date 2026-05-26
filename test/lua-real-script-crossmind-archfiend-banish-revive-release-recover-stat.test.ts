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
const crossmindCode = "52644170";
const banishedPsychicCode = "526441700";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCrossmindScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${crossmindCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const racePsychic = 0x100000;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const eventSpecialSummonSuccess = 1102;
const eventRelease = 1017;

describe.skipIf(!hasUpstreamScripts || !hasCrossmindScript)("Lua real script Crossmind Archfiend banish revive release recover stat", () => {
  it("restores banished Psychic revive and battle release LP recovery into ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${crossmindCode}.lua`);
    expectCrossmindScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 52644170, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [banishedPsychicCode], extra: [crossmindCode] }, 1: { main: [] } });
    startDuel(session);

    const crossmind = requireCard(session, crossmindCode);
    const banishedPsychic = requireCard(session, banishedPsychicCode);
    moveFaceUpAttack(session, crossmind, 0, 0);
    moveDuelCard(session.state, banishedPsychic.uid, "banished", 0);
    banishedPsychic.faceUp = true;
    banishedPsychic.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(crossmindCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredMain = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredMain);
    expectRestoredLegalActions(restoredMain, 0);
    expect(restoredMain.session.state.effects.filter((effect) => effect.sourceUid === crossmind.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], triggerEvent: undefined },
      { category: 512, code: 1002, event: "quick", property: 16, range: ["monsterZone"], triggerEvent: undefined },
      { category: 3145728, code: 1002, event: "quick", property: 16384, range: ["monsterZone"], triggerEvent: undefined },
    ]);
    const revive = getLuaRestoreLegalActions(restoredMain, 0).find((action) => action.type === "activateEffect" && action.uid === crossmind.uid);
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredMain, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredMain, revive!);
    resolveRestoredChain(restoredMain);

    expect(restoredMain.session.state.cards.find((card) => card.uid === banishedPsychic.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: crossmind.uid,
      reasonEffectId: 3,
      sequence: 1,
    });
    expect(restoredMain.session.state.eventHistory.filter((event) => ["becameTarget", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: banishedPsychic.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: eventSpecialSummonSuccess,
        eventCardUid: banishedPsychic.uid,
        eventUids: [banishedPsychic.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: crossmind.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredMain.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    const recoverBoost = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "activateEffect" && action.uid === crossmind.uid);
    expect(recoverBoost, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, recoverBoost!);
    resolveRestoredChain(restoredBattle);

    expect(restoredBattle.session.state.cards.find((card) => card.uid === banishedPsychic.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: crossmind.uid,
      reasonEffectId: 4,
    });
    expect(restoredBattle.session.state.players[0].lifePoints).toBe(9700);
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === crossmind.uid), restoredBattle.session.state)).toBe(4200);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === crossmind.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107235328 }, sourceUid: crossmind.uid, value: 1700 },
    ]);
    expect(restoredBattle.session.state.eventHistory.filter((event) => ["released", "recoveredLifePoints"].includes(event.eventName))).toEqual([
      {
        eventName: "released",
        eventCode: eventRelease,
        eventCardUid: banishedPsychic.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: crossmind.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 0,
        eventValue: 1700,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: crossmind.uid,
        eventReasonEffectId: 4,
      },
    ]);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectCrossmindScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Synchro.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_PSYCHIC),1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetCondition(function() return Duel.IsMainPhase() end)");
  expect(script).toContain("Duel.IsExistingTarget(s.spfilter,tp,LOCATION_REMOVED,0,1,nil,e,tp)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_REMOVED,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_RECOVER+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e2:SetCondition(function() return Duel.IsBattlePhase() and aux.StatChangeDamageStepCondition() end)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.atkfilter,1,false,nil,c)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.atkfilter,1,1,false,nil,c)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.Recover(tp,lpgain,REASON_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(atk)");
}

function cards(): DuelCardData[] {
  return [
    { code: crossmindCode, name: "Crossmind Archfiend", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, setcodes: [0x45], race: racePsychic, attribute: attributeDark, level: 8, attack: 2500, defense: 2800 },
    { code: banishedPsychicCode, name: "Crossmind Banished Psychic", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeDark, level: 7, attack: 1700, defense: 1200 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
