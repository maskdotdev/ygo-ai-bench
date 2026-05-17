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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Smashing Ground maximum defense destroy", () => {
  it("restores Smashing Ground's maximum-DEF opponent monster destroy operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const smashingGroundCode = "97169186";
    const ownMonsterCode = "97169187";
    const opponentHighDefenseCode = "97169188";
    const opponentLowDefenseCode = "97169189";
    const opponentZeroDefenseCode = "97169190";
    const responderCode = "97169191";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === smashingGroundCode),
      { code: ownMonsterCode, name: "Smashing Ground Ally", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 3000 },
      { code: opponentHighDefenseCode, name: "Smashing Ground High Defense Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 900, defense: 2400 },
      { code: opponentLowDefenseCode, name: "Smashing Ground Low Defense Survivor", kind: "monster", typeFlags: 0x1, level: 4, attack: 1700, defense: 1200 },
      { code: opponentZeroDefenseCode, name: "Smashing Ground Zero Defense Survivor", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 0 },
      { code: responderCode, name: "Smashing Ground Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 971, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [smashingGroundCode, ownMonsterCode] }, 1: { main: [opponentHighDefenseCode, opponentLowDefenseCode, opponentZeroDefenseCode, responderCode] } });
    startDuel(session);

    const smashingGround = session.state.cards.find((card) => card.code === smashingGroundCode);
    const ownMonster = session.state.cards.find((card) => card.code === ownMonsterCode);
    const opponentHighDefense = session.state.cards.find((card) => card.code === opponentHighDefenseCode);
    const opponentLowDefense = session.state.cards.find((card) => card.code === opponentLowDefenseCode);
    const opponentZeroDefense = session.state.cards.find((card) => card.code === opponentZeroDefenseCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(smashingGround).toBeDefined();
    expect(ownMonster).toBeDefined();
    expect(opponentHighDefense).toBeDefined();
    expect(opponentLowDefense).toBeDefined();
    expect(opponentZeroDefense).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, smashingGround!.uid, "hand", 0);
    moveDuelCard(session.state, ownMonster!.uid, "monsterZone", 0).position = "faceUpDefense";
    moveDuelCard(session.state, opponentHighDefense!.uid, "monsterZone", 1).position = "faceUpDefense";
    moveDuelCard(session.state, opponentLowDefense!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, opponentZeroDefense!.uid, "monsterZone", 1).position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(smashingGroundCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const smashingGroundAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === smashingGround!.uid);
    expect(smashingGroundAction).toBeDefined();
    applyAndAssert(session, smashingGroundAction!);
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
              "p1-deck-97169188-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-97169186-0",
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [opponentHighDefense!.uid], count: 1, player: 0, parameter: 0 },
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
              "p1-deck-97169188-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-97169186-0",
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [opponentHighDefense!.uid], count: 1, player: 0, parameter: 0 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === smashingGround!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === ownMonster!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentHighDefense!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentLowDefense!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentZeroDefense!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentHighDefense!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 1,
          sequence: 0,
          position: "faceUpDefense",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 1,
          sequence: 0,
          position: "faceUpDefense",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: smashingGround!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.host.messages).not.toContain("smashing ground responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("smashing ground responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
}
