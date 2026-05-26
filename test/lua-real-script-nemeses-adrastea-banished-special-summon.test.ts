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
const setNemeses = 0x13d;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Nemeses Adrastea banished Special Summon", () => {
  it("restores Nemeses Adrastea's banished Nemeses target and Special Summon operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const adrasteaCode = "45666710";
    const banishedNemesesCode = "45666711";
    const banishedDecoyCode = "45666712";
    const responderCode = "45666713";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === adrasteaCode),
      { code: banishedNemesesCode, name: "Nemeses Adrastea Banished Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1700, defense: 1200, setcodes: [setNemeses] },
      { code: banishedDecoyCode, name: "Nemeses Adrastea Banished Decoy", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1000, setcodes: [0x123] },
      { code: responderCode, name: "Nemeses Adrastea Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 456, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [adrasteaCode, banishedNemesesCode, banishedDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const adrastea = session.state.cards.find((card) => card.code === adrasteaCode);
    const banishedNemeses = session.state.cards.find((card) => card.code === banishedNemesesCode);
    const banishedDecoy = session.state.cards.find((card) => card.code === banishedDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(adrastea).toBeDefined();
    expect(banishedNemeses).toBeDefined();
    expect(banishedDecoy).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, adrastea!.uid, "hand", 0);
    moveDuelCard(session.state, banishedNemeses!.uid, "banished", 0).faceUp = true;
    moveDuelCard(session.state, banishedDecoy!.uid, "banished", 0).faceUp = true;
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
    expect(host.loadCardScript(Number(adrasteaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const adrasteaAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === adrastea!.uid);
    expect(adrasteaAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, adrasteaAction!);
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
            "category": 512,
            "count": 1,
            "parameter": 48,
            "player": 0,
            "targetUids": [
              "p0-deck-45666711-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-45666710-0",
        "targetFieldIds": [
          6,
        ],
        "targetUids": [
          "p0-deck-45666711-1",
        ],
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x200, targetUids: [banishedNemeses!.uid], count: 1, player: 0, parameter: 0x30 },
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
            "category": 512,
            "count": 1,
            "parameter": 48,
            "player": 0,
            "targetUids": [
              "p0-deck-45666711-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-45666710-0",
        "targetFieldIds": [
          6,
        ],
        "targetUids": [
          "p0-deck-45666711-1",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x200, targetUids: [banishedNemeses!.uid], count: 1, player: 0, parameter: 0x30 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === adrastea!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === banishedNemeses!.uid)).toMatchObject({
      controller: 0,
      location: "monsterZone",
      position: "faceUpAttack",
      faceUp: true,
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === banishedDecoy!.uid)).toMatchObject({ location: "banished", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === banishedNemeses!.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: banishedNemeses!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: adrastea!.uid,
        eventReasonEffectId: 1,
        eventUids: [banishedNemeses!.uid],
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "banished",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restored.host.messages).not.toContain("nemeses adrastea responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("nemeses adrastea responder resolved") end)
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
