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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const sprightBlueCode = "76145933";
const sprightSearchCode = "76145934";
const levelTwoEnablerCode = "76145935";
const offSetDecoyCode = "76145936";
const responderCode = "76145937";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setSpright = 0x181;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Spright Blue procedure search", () => {
  it("restores its Level/Rank 2 hand Special Summon procedure, oath count, and delayed Deck search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${sprightBlueCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("return c:IsFaceup() and (c:IsLevel(2) or c:IsRank(2))");
    expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and Duel.IsExistingMatchingCard(s.spconfilter,tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return c:IsSetCard(SET_SPRIGHT) and c:IsMonster() and not c:IsCode(id) and c:IsAbleToHand()");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sprightBlueCode),
      { code: sprightSearchCode, name: "Spright Blue Search Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setSpright], level: 2, attack: 1000, defense: 1000 },
      { code: levelTwoEnablerCode, name: "Spright Blue Level 2 Enabler", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 800, defense: 800 },
      { code: offSetDecoyCode, name: "Spright Blue Off-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [0x1], level: 2, attack: 900, defense: 900 },
      { code: responderCode, name: "Spright Blue Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        const text = workspace.readScript(name);
        if (text === undefined) throw new Error(`Missing script ${name}`);
        return text;
      },
    };

    const blocked = createRestoredProcedureWindow({ reader, source, workspace, withEnabler: false });
    expectCleanRestore(blocked);
    expectRestoredLegalActions(blocked, 0);
    expect(getLuaRestoreLegalActions(blocked, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const restoredProcedure = createRestoredProcedureWindow({ reader, source, workspace, withEnabler: true });
    expectCleanRestore(restoredProcedure);
    expectRestoredLegalActions(restoredProcedure, 0);
    const blueCopies = restoredProcedure.session.state.cards.filter((card) => card.code === sprightBlueCode).sort((a, b) => a.uid.localeCompare(b.uid));
    expect(blueCopies).toHaveLength(2);
    const firstBlue = blueCopies[0]!;
    const secondBlue = blueCopies[1]!;
    const searchTarget = requireCard(restoredProcedure.session, sprightSearchCode);
    const decoy = requireCard(restoredProcedure.session, offSetDecoyCode);
    const responder = requireCard(restoredProcedure.session, responderCode);
    const procedure = getLuaRestoreLegalActions(restoredProcedure, 0).find(
      (action): action is Extract<DuelAction, { type: "specialSummonProcedure" }> => action.type === "specialSummonProcedure" && action.uid === firstBlue.uid,
    );
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedure, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProcedure, procedure!);
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === firstBlue.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredProcedure.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toHaveLength(1);
    expect(restoredTrigger.session.state.pendingTriggers[0]).toEqual({
      id: "trigger-4-1",
      effectId: restoredTrigger.session.state.pendingTriggers[0]!.effectId,
      sourceUid: firstBlue.uid,
      player: 0,
      triggerBucket: "turnOptional",
      eventName: "specialSummoned",
      eventCode: 1102,
      eventCardUid: firstBlue.uid,
      eventReason: duelReason.summon | duelReason.specialSummon,
      eventReasonPlayer: 0,
      eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      eventTriggerTiming: "if",
    });
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === firstBlue.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-4",
        chainIndex: 1,
        effectId: restoredTrigger.session.state.chain[0]!.effectId,
        sourceUid: firstBlue.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 1,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: firstBlue.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventTriggerTiming: "if",
        operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("spright blue responder resolved");
    expect(restoredChain.host.messages).toContain(`confirmed 1: ${sprightSearchCode}`);
    expect(restoredChain.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: firstBlue.uid,
      reasonEffectId: 2,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === secondBlue.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(getLuaRestoreLegalActions(restoredChain, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === secondBlue.uid)).toBe(false);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["specialSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: firstBlue.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      sentToHandEvent(searchTarget.uid, firstBlue.uid),
      confirmedEvent(searchTarget.uid, firstBlue.uid),
      sentToHandConfirmedEvent(searchTarget.uid, firstBlue.uid),
    ]);
  });
});

function createRestoredProcedureWindow({
  reader,
  source,
  workspace,
  withEnabler,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  withEnabler: boolean;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: withEnabler ? 76145933 : 76145930, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [sprightBlueCode, sprightBlueCode, sprightSearchCode, levelTwoEnablerCode, offSetDecoyCode] }, 1: { main: [responderCode] } });
  startDuel(session);

  const blueCopies = session.state.cards.filter((card) => card.code === sprightBlueCode);
  const enabler = requireCard(session, levelTwoEnablerCode);
  const responder = requireCard(session, responderCode);
  expect(blueCopies).toHaveLength(2);
  moveDuelCard(session.state, blueCopies[0]!.uid, "hand", 0);
  moveDuelCard(session.state, blueCopies[1]!.uid, "hand", 0);
  if (withEnabler) {
    const moved = moveDuelCard(session.state, enabler.uid, "monsterZone", 0);
    moved.position = "faceUpAttack";
    moved.faceUp = true;
  }
  moveDuelCard(session.state, responder.uid, "hand", 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(sprightBlueCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(3);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function sentToHandEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 4 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 4 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 4 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
  };
}

function requireCard(session: { state: { cards: DuelCardInstance[] } }, code: string): DuelCardInstance {
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = result.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
      e:SetOperation(function(e,tp) Debug.Message("spright blue responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
