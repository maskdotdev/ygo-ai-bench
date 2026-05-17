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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Offerings to the Doomed skip draw", () => {
  it("restores Offerings to the Doomed's target destroy and registered Draw Phase skip", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const offeringsCode = "19230407";
    const targetCode = "19230408";
    const ownMonsterCode = "19230409";
    const responderCode = "19230410";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === offeringsCode),
      { code: targetCode, name: "Offerings Face-up Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
      { code: ownMonsterCode, name: "Offerings Ally Survivor", kind: "monster", typeFlags: 0x1, level: 4, attack: 1400, defense: 2000 },
      { code: responderCode, name: "Offerings Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 192, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [offeringsCode, ownMonsterCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const offerings = session.state.cards.find((card) => card.code === offeringsCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const ownMonster = session.state.cards.find((card) => card.code === ownMonsterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(offerings).toBeDefined();
    expect(target).toBeDefined();
    expect(ownMonster).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, offerings!.uid, "hand", 0);
    moveDuelCard(session.state, ownMonster!.uid, "monsterZone", 0).position = "faceDownDefense";
    ownMonster!.faceUp = false;
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(offeringsCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const offeringsAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === offerings!.uid);
    expect(offeringsAction).toBeDefined();
    applyAndAssert(session, offeringsAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 1,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p1-deck-19230408-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-19230407-0",
        "targetUids": [
          "p1-deck-19230408-0",
        ],
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 1,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p1-deck-19230408-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-19230407-0",
        "targetUids": [
          "p1-deck-19230408-0",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === offerings!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === ownMonster!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.skippedPhases).toEqual([{ player: 0, phase: "draw", remaining: 1 }]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 1,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 1,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: offerings!.uid,
        eventReasonEffectId: 1,
      },
    ]);

    const restoredSkip = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(restoredSkip.restoreComplete, restoredSkip.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSkip.missingRegistryKeys).toEqual([]);
    expect(restoredSkip.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredSkip, 0)).toEqual(getGroupedDuelLegalActions(restoredSkip.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredSkip, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredSkip, 0));
    expect(restoredSkip.session.state.skippedPhases).toEqual([{ player: 0, phase: "draw", remaining: 1 }]);
    expect(restored.host.messages).not.toContain("offerings responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("offerings responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
