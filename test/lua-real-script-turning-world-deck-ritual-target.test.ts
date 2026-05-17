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
const typeMonster = 0x1;
const typeRitual = 0x80;
const typeRitualMonster = typeMonster | typeRitual;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Turning of the World Deck Ritual target", () => {
  it("restores positional Ritual.CreateProc hand-or-Deck target locations", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const turningCode = "95612049";
    const deckRitualTargetCode = "46427957";
    const handRitualMaterialCode = "95612050";
    const nonRitualDecoyCode = "95612051";
    const responderCode = "95612052";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === turningCode),
      { code: deckRitualTargetCode, name: "Turning Deck Ritual Target Fixture", kind: "monster", typeFlags: typeRitualMonster, level: 8, attack: 2500, defense: 2000 },
      { code: handRitualMaterialCode, name: "Turning Hand Ritual Material Fixture", kind: "monster", typeFlags: typeRitualMonster, level: 8, attack: 2400, defense: 2000 },
      { code: nonRitualDecoyCode, name: "Turning Non-Ritual Decoy Fixture", kind: "monster", typeFlags: typeMonster, level: 8, attack: 2400, defense: 2000 },
      { code: responderCode, name: "Turning Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 956, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [turningCode, handRitualMaterialCode, nonRitualDecoyCode, deckRitualTargetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const turning = session.state.cards.find((card) => card.code === turningCode);
    const deckRitualTarget = session.state.cards.find((card) => card.code === deckRitualTargetCode);
    const handRitualMaterial = session.state.cards.find((card) => card.code === handRitualMaterialCode);
    const nonRitualDecoy = session.state.cards.find((card) => card.code === nonRitualDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(turning).toBeDefined();
    expect(deckRitualTarget).toBeDefined();
    expect(handRitualMaterial).toBeDefined();
    expect(nonRitualDecoy).toBeDefined();
    expect(responder).toBeDefined();

    moveDuelCard(session.state, turning!.uid, "hand", 0);
    moveDuelCard(session.state, handRitualMaterial!.uid, "hand", 0);
    moveDuelCard(session.state, nonRitualDecoy!.uid, "hand", 0);
    moveDuelCard(session.state, deckRitualTarget!.uid, "deck", 0);
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
    expect(host.loadCardScript(Number(turningCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === turning!.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x3 }]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x3 }]);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(resolved.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolved.legalActions);

    expect(restored.session.state.cards.find((card) => card.uid === deckRitualTarget!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "ritual",
      summonMaterialUids: [handRitualMaterial!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === handRitualMaterial!.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.material | duelReason.ritual,
    });
    expect(restored.session.state.cards.find((card) => card.uid === nonRitualDecoy!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === turning!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === deckRitualTarget!.uid)).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-46427957-3",
          "eventCode": 1102,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "specialSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 1050640,
          "eventReasonCardUid": "p0-deck-95612049-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
        },
      ]
    `);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === handRitualMaterial!.uid)).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-95612050-1",
          "eventCode": 1014,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventName": "sentToGraveyard",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventReason": 1048584,
          "eventReasonCardUid": "p0-deck-95612049-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
        },
      ]
    `);
    expect(restored.host.messages).not.toContain("turning responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("turning responder resolved") end)
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
  return response;
}
