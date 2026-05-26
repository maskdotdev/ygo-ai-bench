import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const ericaCode = "7407724";
const plantAllyCode = "740772400";
const attackerCode = "740772401";
const releasePlantCode = "740772402";
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePlant = 0x400;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Erica the Rikka Fairy release battle stat revive", () => {
  it("restores hand self-tribute battle stat boost and graveyard release-trigger revive redirect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ericaCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE|LOCATION_HAND)");
    expect(script).toContain("e1:SetCost(Cost.SelfTribute)");
    expect(script).toContain("return tc and tc~=e:GetHandler() and tc:IsFaceup() and tc:IsControler(tp) and tc:IsRace(RACE_PLANT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e2:SetCode(EVENT_RELEASE)");
    expect(script).toContain("return eg:IsExists(s.spcfilter,1,nil,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,0,LOCATION_GRAVE)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
    expect(script).toContain("e1:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_CLIENT_HINT)");
    expect(script).toContain("e1:SetValue(LOCATION_REMOVED)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ericaCode),
      { code: plantAllyCode, name: "Erica Fixture Plant Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, level: 4, attack: 1600, defense: 1200 },
      { code: attackerCode, name: "Erica Fixture Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1800, defense: 1000 },
      { code: releasePlantCode, name: "Erica Fixture Released Plant", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7407724, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ericaCode, plantAllyCode, releasePlantCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const erica = requireCard(session, ericaCode);
    const plantAlly = requireCard(session, plantAllyCode);
    const attacker = requireCard(session, attackerCode);
    const releasePlant = requireCard(session, releasePlantCode);
    moveDuelCard(session.state, erica.uid, "hand", 0);
    moveDuelCard(session.state, plantAlly.uid, "monsterZone", 0);
    plantAlly.faceUp = true;
    plantAlly.position = "faceUpAttack";
    moveDuelCard(session.state, attacker.uid, "monsterZone", 1);
    attacker.faceUp = true;
    attacker.position = "faceUpAttack";
    moveDuelCard(session.state, releasePlant.uid, "graveyard", 0);
    releasePlant.faceUp = true;
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ericaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === plantAlly.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    if (restoredTrigger.session.state.pendingTriggers.length === 0) return;
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1130",
        effectLabelObjectUid: plantAlly.uid,
        eventCardUid: attacker.uid,
        eventCode: 1130,
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "attackDeclared",
        eventPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: erica.uid,
        triggerBucket: "opponentOptional",
      },
    ]);
    const boostTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === erica.uid);
    expect(boostTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, boostTrigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, restoredBoost.session.state.waitingFor ?? restoredBoost.session.state.turnPlayer);
    expect(restoredBoost.session.state.cards.find((card) => card.uid === erica.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: erica.uid,
      reasonEffectId: 1,
    });
    const boostedPlant = restoredBoost.session.state.cards.find((card) => card.uid === plantAlly.uid);
    expect(boostedPlant).toBeDefined();
    expect(currentAttack(boostedPlant, restoredBoost.session.state)).toBe(2600);
    expect(currentDefense(boostedPlant, restoredBoost.session.state)).toBe(2200);
    expect(restoredBoost.session.state.effects.filter((effect) => effect.sourceUid === plantAlly.uid && (effect.code === 100 || effect.code === 104))).toEqual([
      expect.objectContaining({ code: 100, event: "continuous", value: 1000 }),
      expect.objectContaining({ code: 104, event: "continuous", value: 1000 }),
    ]);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "released")).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: erica.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: erica.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
    ]);

    const reviveSession = createDuel({ seed: 7407725, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(reviveSession, { 0: { main: [ericaCode, releasePlantCode] }, 1: { main: [] } });
    startDuel(reviveSession);
    const reviveErica = requireCard(reviveSession, ericaCode);
    const revivePlant = requireCard(reviveSession, releasePlantCode);
    moveDuelCard(reviveSession.state, reviveErica.uid, "graveyard", 0);
    reviveErica.faceUp = true;
    moveDuelCard(reviveSession.state, revivePlant.uid, "monsterZone", 0);
    revivePlant.faceUp = true;
    revivePlant.position = "faceUpAttack";
    reviveSession.state.phase = "main1";
    reviveSession.state.turnPlayer = 0;
    reviveSession.state.waitingFor = 0;

    const reviveHost = createLuaScriptHost(reviveSession, workspace);
    expect(reviveHost.loadCardScript(Number(ericaCode), workspace).ok).toBe(true);
    expect(reviveHost.registerInitialEffects()).toBe(1);
    const releaseEvent = {
      eventName: "released" as const,
      eventCode: 1017,
      eventCardUid: revivePlant.uid,
      eventReason: duelReason.cost | duelReason.release,
      eventReasonPlayer: 0 as PlayerId,
      eventReasonCardUid: revivePlant.uid,
      eventReasonEffectId: 99,
      eventPreviousState: { controller: 0 as PlayerId, faceUp: true, location: "monsterZone" as const, position: "faceUpAttack" as const, sequence: 0 },
      eventCurrentState: { controller: 0 as PlayerId, faceUp: true, location: "graveyard" as const, position: "faceUpAttack" as const, sequence: 0 },
    };
    reviveSession.state.eventHistory.push(releaseEvent);
    reviveSession.state.pendingTriggers.push({
      id: "trigger-erica-release",
      effectId: "lua-2-1017",
      sourceUid: reviveErica.uid,
      player: 0,
      triggerBucket: "turnOptional",
      eventTriggerTiming: "if",
      ...releaseEvent,
    });
    const restoredRevive = restoreDuelWithLuaScripts(serializeDuel(reviveSession), workspace, reader);
    expectCleanRestore(restoredRevive);
    expectRestoredLegalActions(restoredRevive, 0);
    const reviveTrigger = getLuaRestoreLegalActions(restoredRevive, 0).find((action) => action.type === "activateTrigger" && action.uid === reviveErica.uid);
    expect(reviveTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredRevive, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRevive, reviveTrigger!);
    expect(restoredRevive.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    const restoredReviveChain = restoreDuelWithLuaScripts(serializeDuel(restoredRevive.session), workspace, reader);
    expectCleanRestore(restoredReviveChain);
    expectRestoredLegalActions(restoredReviveChain, restoredReviveChain.session.state.waitingFor ?? restoredReviveChain.session.state.turnPlayer);
    expect(restoredReviveChain.session.state.cards.find((card) => card.uid === reviveErica.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: reviveErica.uid,
      reasonEffectId: 2,
    });
    expect(restoredReviveChain.session.state.effects.filter((effect) => effect.sourceUid === reviveErica.uid && effect.code === 60).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 60, event: "continuous", property: 0x4000400, range: ["monsterZone"], reset: { flags: 209326080 }, value: 0x20 },
    ]);
    expect(restoredReviveChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: reviveErica.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: reviveErica.uid,
        eventReasonEffectId: 2,
        eventUids: [reviveErica.uid],
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 1 },
      },
    ]);
  });
});

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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor;
  expect(player).toBeDefined();
  const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}
