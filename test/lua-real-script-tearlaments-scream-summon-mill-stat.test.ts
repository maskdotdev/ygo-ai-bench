import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const screamCode = "6767771";
const hasScreamScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${screamCode}.lua`));
const tearFaceupCode = "67677710";
const summonedCode = "67677711";
const millACode = "67677712";
const millBCode = "67677713";
const millCCode = "67677714";
const opponentCode = "67677715";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setTearlaments = 0x182;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasScreamScript)("Lua real script Tearlaments Scream summon mill stat", () => {
  it("restores summon-success field trigger into self Deck mill and opponent ATK reduction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${screamCode}.lua`);
    expect(script).toContain("e0:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCategory(CATEGORY_DECKDES+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("Duel.IsPlayerCanDiscardDeck(tp,3)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_ONFIELD,0,1,nil)");
    expect(script).toContain("Duel.DiscardDeck(tp,3,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetTargetRange(0,LOCATION_MZONE)");
    expect(script).toContain("e1:SetValue(-500)");
    expect(script).toContain("Duel.RegisterEffect(e1,tp)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === screamCode),
      { code: tearFaceupCode, name: "Scream Tearlaments Faceup", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setTearlaments], level: 4, attack: 1600, defense: 1000 },
      { code: summonedCode, name: "Scream Normal Summon", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
      { code: millACode, name: "Scream Mill A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: millBCode, name: "Scream Mill B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: millCCode, name: "Scream Mill C", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: opponentCode, name: "Scream Opponent Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6767771, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [screamCode, tearFaceupCode, summonedCode, millACode, millBCode, millCCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const scream = requireCard(session, screamCode);
    const tearFaceup = requireCard(session, tearFaceupCode);
    const summoned = requireCard(session, summonedCode);
    const millA = requireCard(session, millACode);
    const millB = requireCard(session, millBCode);
    const millC = requireCard(session, millCCode);
    const opponent = requireCard(session, opponentCode);
    moveDuelCard(session.state, scream.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, tearFaceup.uid, "monsterZone", 0).position = "faceUpAttack";
    tearFaceup.faceUp = true;
    moveDuelCard(session.state, summoned.uid, "hand", 0);
    moveDuelCard(session.state, millA.uid, "deck", 0);
    moveDuelCard(session.state, millB.uid, "deck", 0);
    moveDuelCard(session.state, millC.uid, "deck", 0);
    moveDuelCard(session.state, opponent.uid, "monsterZone", 1).position = "faceUpAttack";
    opponent.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(screamCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === summoned.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, summon!);

    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-1100",
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: summoned.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: scream.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === scream.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);

    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponent.uid), restoredTrigger.session.state)).toBe(1500);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === scream.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      {
        code: 100,
        controller: 0,
        event: "continuous",
        range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"],
        reset: { flags: 1073742336 },
        sourceUid: scream.uid,
        targetRange: [0, 4],
        value: -500,
      },
    ]);
    expect([millA, millB, millC].map((card) => restoredTrigger.session.state.cards.find((candidate) => candidate.uid === card.uid)).map((card) => ({
      location: card?.location,
      controller: card?.controller,
      reason: card?.reason,
      reasonPlayer: card?.reasonPlayer,
      reasonCardUid: card?.reasonCardUid,
      reasonEffectId: card?.reasonEffectId,
    }))).toEqual([
      { location: "graveyard", controller: 0, reason: duelReason.effect, reasonPlayer: 0, reasonCardUid: scream.uid, reasonEffectId: 2 },
      { location: "graveyard", controller: 0, reason: duelReason.effect, reasonPlayer: 0, reasonCardUid: scream.uid, reasonEffectId: 2 },
      { location: "graveyard", controller: 0, reason: duelReason.effect, reasonPlayer: 0, reasonCardUid: scream.uid, reasonEffectId: 2 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: summoned.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      ...[millA, millB, millC].map((card, index) => ({
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: card.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: scream.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: index },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: index },
      })),
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: millA.uid,
        eventUids: [millA.uid, millB.uid, millC.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: scream.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
