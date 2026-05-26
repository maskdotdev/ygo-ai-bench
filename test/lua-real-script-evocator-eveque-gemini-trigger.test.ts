import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Evocator Eveque Gemini trigger", () => {
  it("restores targeting and resolution after a second Normal Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const evequeCode = "16146511";
    const geminiTargetCode = "3918345";
    const responderCode = "928";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [evequeCode, geminiTargetCode].includes(card.code)),
      { code: responderCode, name: "Evocator Eveque Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 312, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [evequeCode, geminiTargetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const eveque = session.state.cards.find((card) => card.code === evequeCode && card.location === "deck");
    const target = session.state.cards.find((card) => card.code === geminiTargetCode && card.location === "deck");
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(eveque).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, eveque!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "graveyard", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    eveque!.faceUp = true;
    eveque!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(evequeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    const geminiSummon = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "normalSummon" && action.uid === eveque!.uid);
    expect(geminiSummon, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(applyLuaRestoreResponse(restored, geminiSummon!).ok).toBe(true);

    const triggerRestored = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(triggerRestored.restoreComplete, triggerRestored.incompleteReasons.join("; ")).toBe(true);
    expect(triggerRestored.missingRegistryKeys).toEqual([]);
    expect(triggerRestored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(triggerRestored, 0);
    const trigger = getLuaRestoreLegalActions(triggerRestored, 0).find((action) => action.type === "activateTrigger" && action.uid === eveque!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(triggerRestored, 0), null, 2)).toBeDefined();
    expect(applyLuaRestoreResponse(triggerRestored, trigger!).ok).toBe(true);
    expect(triggerRestored.session.state.chain).toHaveLength(1);
    expect(triggerRestored.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "monsterZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-4-1100",
        "eventCardUid": "p0-deck-16146511-0",
        "eventCode": 1100,
        "eventCurrentState": {
          "controller": 0,
          "faceUp": true,
          "location": "monsterZone",
          "position": "faceUpAttack",
          "sequence": 0,
        },
        "eventName": "normalSummoned",
        "eventPlayer": 0,
        "eventPreviousState": {
          "controller": 0,
          "faceUp": true,
          "location": "monsterZone",
          "position": "faceUpAttack",
          "sequence": 0,
        },
        "eventReason": 0,
        "eventReasonPlayer": 0,
        "eventTriggerTiming": "if",
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 512,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-3918345-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-16146511-0",
        "targetFieldIds": [
          5,
        ],
        "targetUids": [
          "p0-deck-3918345-1",
        ],
      }
    `);

    const chainRestored = restoreDuelWithLuaScripts(serializeDuel(triggerRestored.session), source, reader);
    expect(chainRestored.restoreComplete, chainRestored.incompleteReasons.join("; ")).toBe(true);
    expect(chainRestored.missingRegistryKeys).toEqual([]);
    expect(chainRestored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(chainRestored, 1);
    expect(getLuaRestoreLegalActions(chainRestored, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(chainRestored, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(chainRestored, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(chainRestored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(chainRestored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(chainRestored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: target!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: eveque!.uid,
        eventReasonEffectId: 4,
        eventUids: [target!.uid],
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);
    expect(chainRestored.host.messages).not.toContain("evocator eveque responder resolved");
  });
});

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
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
      e:SetOperation(function(e,tp) Debug.Message("evocator eveque responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
