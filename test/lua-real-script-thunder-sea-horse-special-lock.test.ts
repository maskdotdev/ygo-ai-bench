import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const raceThunder = 0x1000;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Thunder Sea Horse Special Summon lock", () => {
  it("restores its discard cost, same-code search, and oath Special Summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const seaHorseCode = "48049769";
    const searchCode = "48049770";
    const procedureCode = "48049771";
    const responderCode = "48049772";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === seaHorseCode),
      { code: searchCode, name: "Thunder Sea Horse Search Target", kind: "monster", typeFlags: 0x21, level: 4, attack: 1500, defense: 1000, race: raceThunder, attribute: attributeLight },
      { code: procedureCode, name: "Thunder Sea Horse Procedure", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Thunder Sea Horse Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 480, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [seaHorseCode, searchCode, searchCode, procedureCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const seaHorse = requireCard(session, seaHorseCode);
    const procedure = requireCard(session, procedureCode);
    const responder = requireCard(session, responderCode);
    const searchTargets = session.state.cards.filter((card) => card.code === searchCode).sort((a, b) => a.uid.localeCompare(b.uid));
    const selectedSearchTargetUids = searchTargets.map((card) => card.uid).reverse();
    expect(searchTargets).toHaveLength(2);
    moveDuelCard(session.state, seaHorse.uid, "hand", 0);
    moveDuelCard(session.state, procedure.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${procedureCode}.lua`) return specialProcedureScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(seaHorseCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(procedureCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(getLegalActions(session, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === procedure.uid)).toBe(true);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === seaHorse.uid);
    expect(activation).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.cards.find((card) => card.uid === seaHorse.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
    });
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1",
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 8,
            "count": 2,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-48049769-0",
      }
    `);
    expect(session.state.effects.find((effect) => effect.sourceUid === seaHorse.uid && effect.code === 22)).toMatchObject({
      event: "continuous",
      targetRange: [1, 0],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === seaHorse.uid && effect.code === 22)).toMatchObject({
      event: "continuous",
      targetRange: [1, 0],
    });

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.host.messages).not.toContain("thunder sea horse responder resolved");
    expect(searchTargets.map((card) => restored.session.state.cards.find((candidate) => candidate.uid === card.uid))).toEqual([
      expect.objectContaining({ uid: searchTargets[0]!.uid, location: "hand", controller: 0 }),
      expect.objectContaining({ uid: searchTargets[1]!.uid, location: "hand", controller: 0 }),
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["sentToGraveyard", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: seaHorse.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: seaHorse.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: searchTargets[1]!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: seaHorse.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "deck", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: searchTargets[0]!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: seaHorse.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "deck", sequence: 3, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 2, position: "faceDown", faceUp: false },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: searchTargets[1]!.uid,
        eventUids: selectedSearchTargetUids,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: seaHorse.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "deck", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventPlayer: 1,
        eventUids: selectedSearchTargetUids,
        eventValue: 2,
        eventCardUid: searchTargets[1]!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: seaHorse.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "deck", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventPlayer: 1,
        eventUids: selectedSearchTargetUids,
        eventValue: 2,
        eventCardUid: searchTargets[1]!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: seaHorse.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, location: "deck", sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
      },
    ]);

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredLock, 0);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === procedure.uid)).toBe(false);
  });
});

function specialProcedureScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_FIELD)
      e:SetCode(EFFECT_SPSUMMON_PROC)
      e:SetRange(LOCATION_HAND)
      c:RegisterEffect(e)
    end
  `;
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
      e:SetOperation(function(e,tp) Debug.Message("thunder sea horse responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
