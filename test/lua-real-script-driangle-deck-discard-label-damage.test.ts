import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const driangleCode = "98248208";
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Driangle deck-discard label damage", () => {
  it("restores hand self-summon into deck-discard cost label, ATK gain, and effect damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const costMonsterCode = "982482080";
    const level10ACode = "982482081";
    const level10BCode = "982482082";
    const level10CCode = "982482083";
    const responderCode = "982482084";
    const script = workspace.readScript(`c${driangleCode}.lua`);
    expect(script).toContain("Duel.IsPlayerCanDiscardDeckAsCost(tp,1)");
    expect(script).toContain("Duel.DiscardDeck(tp,1,REASON_COST)");
    expect(script).toContain("Duel.GetOperatedGroup():GetFirst():IsMonster() and 1 or 0");
    expect(script).toContain("e:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DAMAGE)");
    expect(script).toContain("Duel.Damage(1-tp,1000,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === driangleCode),
      { code: costMonsterCode, name: "Driangle Cost Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: level10ACode, name: "Driangle Level 10 A", kind: "monster", typeFlags: typeMonster, level: 10, attack: 2000, defense: 1000 },
      { code: level10BCode, name: "Driangle Level 10 B", kind: "monster", typeFlags: typeMonster, level: 10, attack: 2100, defense: 1000 },
      { code: level10CCode, name: "Driangle Level 10 C", kind: "monster", typeFlags: typeMonster, level: 10, attack: 2200, defense: 1000 },
      { code: responderCode, name: "Driangle Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 98248208, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [costMonsterCode, driangleCode, level10ACode, level10BCode, level10CCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const driangle = requireCard(session, driangleCode);
    const costMonster = requireCard(session, costMonsterCode);
    const level10A = requireCard(session, level10ACode);
    const level10B = requireCard(session, level10BCode);
    const level10C = requireCard(session, level10CCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, driangle.uid, "hand", 0);
    moveDuelCard(session.state, level10A.uid, "monsterZone", 0).position = "faceUpAttack";
    level10A.faceUp = true;
    moveDuelCard(session.state, level10B.uid, "graveyard", 0).faceUp = true;
    moveDuelCard(session.state, level10C.uid, "banished", 0).faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(driangleCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const selfSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === driangle.uid);
    expect(selfSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestored(restoredOpen, selfSummon!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: driangle.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x200, count: 1, parameter: 0, player: 0, targetUids: [driangle.uid] }],
      },
    ]);

    const restoredSummonChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredSummonChain);
    expectRestoredLegalActions(restoredSummonChain, 1);
    passChain(restoredSummonChain, 1);
    expect(restoredSummonChain.session.state.cards.find((card) => card.uid === driangle.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "special",
    });

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonChain.session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-2-1102",
        sourceUid: driangle.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: driangle.uid,
        eventUids: [driangle.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: driangle.uid,
        eventReasonEffectId: 1,
        eventPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === driangle.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestored(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === costMonster.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: driangle.uid,
      reasonEffectId: 2,
    });
    expect(restoredTriggerWindow.session.state.chain).toEqual([
      {
        id: "chain-6",
        chainIndex: 1,
        effectId: "lua-2-1102",
        sourceUid: driangle.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 1,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: driangle.uid,
        eventUids: [driangle.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: driangle.uid,
        eventReasonEffectId: 1,
        eventPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        effectLabel: 1,
        operationInfos: [
          { category: 0x200000, count: 1, parameter: 500, player: 0, targetUids: [driangle.uid] },
          { category: 0x80000, count: 1, parameter: 1000, player: 1, targetUids: [] },
        ],
      },
    ]);

    const restoredDamageChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredDamageChain);
    expectRestoredLegalActions(restoredDamageChain, 1);
    expect(getLuaRestoreLegalActions(restoredDamageChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passChain(restoredDamageChain, 1);
    expect(currentAttack(restoredDamageChain.session.state.cards.find((card) => card.uid === driangle.uid), restoredDamageChain.session.state)).toBe(
      (driangle.data.attack ?? 0) + 500,
    );
    expect(restoredDamageChain.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredDamageChain.session.state.eventHistory.filter((event) => ["discarded", "sentToGraveyard", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: costMonster.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: driangle.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: driangle.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(host.messages).not.toContain("driangle responder resolved");
    expect(restoredDamageChain.host.messages).not.toContain("driangle responder resolved");
  });
});

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("driangle responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestored(restored, pass!);
}

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
