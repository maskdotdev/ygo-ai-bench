import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Primite Imperial Dragon", () => {
  it("restores its custom Tribute Summon trigger and banishes matching opponent monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const imperialCode = "81418467";
    const darkMagicianCode = "46986414";
    const tributeDecoyCode = "81490000";
    const opponentTargetCode = "81490001";
    const responderCode = "81490002";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [imperialCode, darkMagicianCode].includes(card.code)),
      { code: tributeDecoyCode, name: "Imperial Tribute Decoy", kind: "monster", typeFlags: 0x21, level: 4, race: 0x2000, attribute: 0x1 },
      { code: opponentTargetCode, name: "Imperial Matching Spellcaster", kind: "monster", typeFlags: 0x21, level: 4, race: 0x2, attribute: 0x20 },
      { code: responderCode, name: "Imperial Chain Responder", kind: "monster", typeFlags: 0x21, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 814, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [imperialCode, darkMagicianCode, tributeDecoyCode] },
      1: { main: [opponentTargetCode, responderCode] },
    });
    startDuel(session);

    const imperial = session.state.cards.find((card) => card.code === imperialCode);
    const darkMagician = session.state.cards.find((card) => card.code === darkMagicianCode);
    const tributeDecoy = session.state.cards.find((card) => card.code === tributeDecoyCode);
    const opponentTarget = session.state.cards.find((card) => card.code === opponentTargetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(imperial).toBeDefined();
    expect(darkMagician).toBeDefined();
    expect(tributeDecoy).toBeDefined();
    expect(opponentTarget).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, imperial!.uid, "hand", 0);
    moveDuelCard(session.state, tributeDecoy!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, darkMagician!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, opponentTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${opponentTargetCode}.lua`) return negatableMonsterScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(imperialCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentTargetCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const summonActions = getLegalActions(session, 0).filter((action) => (action.type === "tributeSummon" || action.type === "normalSummon") && action.uid === imperial!.uid);
    expect(summonActions).toEqual([
      expect.objectContaining({
        type: "tributeSummon",
        effectId: expect.stringMatching(/^lua-/),
        tributeUids: [],
      }),
    ]);
    applyAndAssert(session, summonActions[0]!);
    expect(session.state.cards.find((card) => card.uid === imperial!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, summonType: "tribute" });
    expect(session.state.cards.find((card) => card.uid === darkMagician!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(session.state.cards.find((card) => card.uid === tributeDecoy!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });

    const trigger = getLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.uid === imperial!.uid);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);
    expect(session.state.chain).toMatchInlineSnapshot(`
      [
        {
          "activationLocation": "monsterZone",
          "activationSequence": 1,
          "chainIndex": 1,
          "effectId": "lua-3-1100",
          "eventCardUid": "p0-deck-81418467-0",
          "eventCode": 1100,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventName": "normalSummoned",
          "eventPlayer": 0,
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 16,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "if",
          "id": "chain-5",
          "operationInfos": [
            {
              "category": 16384,
              "count": 1,
              "parameter": 0,
              "player": 0,
              "targetUids": [
                "p1-deck-81490001-0",
              ],
            },
            {
              "category": 4,
              "count": 1,
              "parameter": 0,
              "player": 0,
              "targetUids": [
                "p1-deck-81490001-0",
              ],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-81418467-0",
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === opponentTarget!.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      faceUp: true,
    });
    expect(restored.session.state.cards.find((card) => card.uid === imperial!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "tribute",
    });
    expect(restored.session.state.cards.find((card) => card.uid === tributeDecoy!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
  });
});

function negatableMonsterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp) Debug.Message("imperial target resolved") end)
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
      e:SetOperation(function(e,tp) Debug.Message("imperial responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  for (let index = 0; index < 8 && restored.session.state.chain.length > 0; index += 1) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const response = applyLuaRestoreResponse(restored, pass!);
    expect(response.ok, response.error).toBe(true);
  }
  expect(restored.session.state.chain).toHaveLength(0);
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
