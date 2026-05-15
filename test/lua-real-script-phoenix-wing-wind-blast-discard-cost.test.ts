import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getCards, moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Phoenix Wing Wind Blast discard cost", () => {
  it("restores Phoenix Wing Wind Blast's discarded cost card, target, and deck-top return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const phoenixWingCode = "63356631";
    const starterCode = "906";
    const responderCode = "907";
    const discardCode = "908";
    const targetCode = "909";
    const deckAnchorCode = "910";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === phoenixWingCode),
      { code: starterCode, name: "Phoenix Wing Chain Starter", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Phoenix Wing Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: discardCode, name: "Phoenix Wing Discard Cost", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: targetCode, name: "Phoenix Wing Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1200 },
      { code: deckAnchorCode, name: "Phoenix Wing Deck Anchor", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 470, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterCode, responderCode, targetCode, deckAnchorCode] }, 1: { main: [phoenixWingCode, discardCode] } });
    startDuel(session);

    const starter = session.state.cards.find((card) => card.code === starterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const discard = session.state.cards.find((card) => card.code === discardCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const phoenixWing = session.state.cards.find((card) => card.code === phoenixWingCode);
    expect(starter).toBeDefined();
    expect(responder).toBeDefined();
    expect(discard).toBeDefined();
    expect(target).toBeDefined();
    expect(phoenixWing).toBeDefined();
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.position = "faceUpAttack";
    target!.faceUp = true;
    moveDuelCard(session.state, discard!.uid, "hand", 1);
    moveDuelCard(session.state, phoenixWing!.uid, "spellTrapZone", 1);
    phoenixWing!.position = "faceDown";
    phoenixWing!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return chainStarterScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(phoenixWingCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);

    const phoenixWingAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === phoenixWing!.uid);
    expect(phoenixWingAction).toBeDefined();
    applyAndAssert(session, phoenixWingAction!);
    expect(session.state.cards.find((card) => card.uid === discard!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "discarded", eventCode: 1018, eventCardUid: discard!.uid })]));
    expect(session.state.chain).toHaveLength(2);
    expect(session.state.chain[1]).toMatchObject({
      sourceUid: phoenixWing!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x10, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === discard!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "discarded", eventCode: 1018, eventCardUid: discard!.uid })]));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.chain).toHaveLength(2);
    expect(restored.session.state.chain[1]).toMatchObject({
      sourceUid: phoenixWing!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x10, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const pass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(getCards(restored.session.state, 0, "deck").map((card) => card.uid)[0]).toBe(target!.uid);
    expect(restored.session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "sentToDeck", eventCode: 1013, eventCardUid: target!.uid })]));
    expect(restored.session.state.cards.find((card) => card.uid === phoenixWing!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.host.messages).toContain("phoenix wing chain starter resolved");
    expect(restored.host.messages).not.toContain("phoenix wing chain responder resolved");
  });
});

function chainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("phoenix wing chain starter resolved") end)
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
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>1 end)
      e:SetOperation(function(e,tp) Debug.Message("phoenix wing chain responder resolved") end)
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
