import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const setIceBarrier = 0x2f;
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Sacred Spirit of the Ice Barrier return", () => {
  it("restores its Ice Barrier ally End Phase trigger and returns an opponent monster to hand", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sacredSpiritCode = "44877690";
    const iceBarrierAllyCode = "44877691";
    const opponentTargetCode = "44877692";
    const opponentDecoyCode = "44877693";
    const responderCode = "44877694";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sacredSpiritCode),
      { code: iceBarrierAllyCode, name: "Sacred Spirit Ice Barrier Ally", kind: "monster", typeFlags: typeMonster, setcodes: [setIceBarrier], level: 4, attack: 1600, defense: 1200 },
      { code: opponentTargetCode, name: "Sacred Spirit Return Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1000 },
      { code: opponentDecoyCode, name: "Sacred Spirit Return Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1700, defense: 900 },
      { code: responderCode, name: "Sacred Spirit Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 448, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sacredSpiritCode, iceBarrierAllyCode] }, 1: { main: [opponentTargetCode, opponentDecoyCode, responderCode] } });
    startDuel(session);

    const sacredSpirit = session.state.cards.find((card) => card.code === sacredSpiritCode);
    const iceBarrierAlly = session.state.cards.find((card) => card.code === iceBarrierAllyCode);
    const opponentTarget = session.state.cards.find((card) => card.code === opponentTargetCode);
    const opponentDecoy = session.state.cards.find((card) => card.code === opponentDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(sacredSpirit).toBeDefined();
    expect(iceBarrierAlly).toBeDefined();
    expect(opponentTarget).toBeDefined();
    expect(opponentDecoy).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, sacredSpirit!.uid, "hand", 0);
    moveDuelCard(session.state, iceBarrierAlly!.uid, "monsterZone", 0);
    iceBarrierAlly!.position = "faceUpAttack";
    iceBarrierAlly!.faceUp = true;
    moveDuelCard(session.state, opponentTarget!.uid, "monsterZone", 1);
    opponentTarget!.position = "faceUpAttack";
    opponentTarget!.faceUp = true;
    moveDuelCard(session.state, opponentDecoy!.uid, "monsterZone", 1);
    opponentDecoy!.position = "faceUpAttack";
    opponentDecoy!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sacredSpiritCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === sacredSpirit!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const restoredAfterSummon = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredAfterSummon.restoreComplete, restoredAfterSummon.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterSummon.missingRegistryKeys).toEqual([]);
    expect(restoredAfterSummon.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredAfterSummon, 0);
    advanceRestoredToEndPhase(restoredAfterSummon);
    expect(restoredAfterSummon.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-1-4608",
          "eventCode": 4608,
          "eventName": "phaseEnd",
          "eventTriggerTiming": "when",
          "id": "trigger-7-1",
          "player": 0,
          "sourceUid": "p0-deck-44877690-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);

    const returnTrigger = getLuaRestoreLegalActions(restoredAfterSummon, 0).find((action) => action.type === "activateTrigger" && action.uid === sacredSpirit!.uid);
    expect(returnTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredAfterSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAfterSummon, returnTrigger!);
    expect(restoredAfterSummon.session.state.effects.find((effect) => effect.id === "lua-1-4608" && effect.sourceUid === sacredSpirit!.uid)?.property).toBe(0x10);
    expect(serializeDuel(restoredAfterSummon.session).state.effects.find((effect) => effect.id === "lua-1-4608" && effect.sourceUid === sacredSpirit!.uid)?.property).toBe(0x10);
    expect(restoredAfterSummon.session.state.chain).toMatchInlineSnapshot(`
      [
        {
          "activationLocation": "monsterZone",
          "activationSequence": 1,
          "chainIndex": 1,
          "effectId": "lua-1-4608",
          "eventCode": 4608,
          "eventName": "phaseEnd",
          "eventTriggerTiming": "when",
          "id": "chain-7",
          "operationInfos": [
            {
              "category": 8,
              "count": 1,
              "parameter": 0,
              "player": 0,
              "targetUids": [
                "p1-deck-44877692-0",
              ],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-44877690-0",
          "targetFieldIds": [
            8,
          ],
          "targetUids": [
            "p1-deck-44877692-0",
          ],
        },
      ]
    `);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredAfterSummon.session), source, reader);
    expect(restoredChainWindow.restoreComplete, restoredChainWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChainWindow.missingRegistryKeys).toEqual([]);
    expect(restoredChainWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredChainWindow.session.state.effects.find((effect) => effect.id === "lua-1-4608" && effect.sourceUid === sacredSpirit!.uid)?.property).toBe(0x10);
    expectRestoredLegalActions(restoredChainWindow, 1);
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChainWindow, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChainWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === sacredSpirit!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === iceBarrierAlly!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === opponentTarget!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === opponentDecoy!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => event.eventName === "sentToHand" && event.eventCardUid === opponentTarget!.uid)).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: opponentTarget!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: sacredSpirit!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: false,
          location: "hand",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);
    expect(restoredChainWindow.host.messages).not.toContain("sacred spirit responder resolved");
  });
});

function advanceRestoredToEndPhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  for (const phase of ["battle", "main2", "end"] as const) {
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
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
      e:SetOperation(function(e,tp) Debug.Message("sacred spirit responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
