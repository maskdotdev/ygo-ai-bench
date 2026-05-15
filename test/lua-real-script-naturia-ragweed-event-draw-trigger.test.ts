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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Naturia Ragweed draw trigger", () => {
  it("restores Naturia Ragweed's opponent-draw trigger, self cost, and CHAININFO draw count", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const giftOfGreedCode = "5915629";
    const ragweedCode = "87649699";
    const opponentDrawnCode = "913";
    const opponentDrawnSecondCode = "914";
    const ragweedDrawnCode = "915";
    const ragweedDrawnSecondCode = "916";
    const responderCode = "917";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === giftOfGreedCode || card.code === ragweedCode),
      { code: opponentDrawnCode, name: "Ragweed Opponent Drawn Card A", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentDrawnSecondCode, name: "Ragweed Opponent Drawn Card B", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: ragweedDrawnCode, name: "Ragweed Drawn Card A", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: ragweedDrawnSecondCode, name: "Ragweed Drawn Card B", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Naturia Ragweed Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 876, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [opponentDrawnCode, opponentDrawnSecondCode, responderCode] },
      1: { main: [giftOfGreedCode, ragweedCode, ragweedDrawnCode, ragweedDrawnSecondCode] },
    });
    startDuel(session);

    const giftOfGreed = session.state.cards.find((card) => card.code === giftOfGreedCode);
    const ragweed = session.state.cards.find((card) => card.code === ragweedCode);
    const opponentDrawn = session.state.cards.find((card) => card.code === opponentDrawnCode);
    const opponentDrawnSecond = session.state.cards.find((card) => card.code === opponentDrawnSecondCode);
    const ragweedDrawn = session.state.cards.find((card) => card.code === ragweedDrawnCode);
    const ragweedDrawnSecond = session.state.cards.find((card) => card.code === ragweedDrawnSecondCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(giftOfGreed).toBeDefined();
    expect(ragweed).toBeDefined();
    expect(opponentDrawn).toBeDefined();
    expect(opponentDrawnSecond).toBeDefined();
    expect(ragweedDrawn).toBeDefined();
    expect(ragweedDrawnSecond).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, giftOfGreed!.uid, "spellTrapZone", 1);
    giftOfGreed!.position = "faceDown";
    giftOfGreed!.faceUp = false;
    moveDuelCard(session.state, ragweed!.uid, "monsterZone", 1);
    ragweed!.position = "faceUpAttack";
    ragweed!.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(giftOfGreedCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(ragweedCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const giftOfGreedAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === giftOfGreed!.uid);
    expect(giftOfGreedAction).toBeDefined();
    applyAndAssert(session, giftOfGreedAction!);
    const passGift = getLegalActions(session, 0).find((action) => action.type === "passChain");
    expect(passGift).toBeDefined();
    applyAndAssert(session, passGift!);

    expect(session.state.cards.find((card) => card.uid === opponentDrawn!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(session.state.cards.find((card) => card.uid === opponentDrawnSecond!.uid)).toMatchObject({ location: "hand", controller: 0 });
    const ragweedAction = getLegalActions(session, 1).find((action) => action.type === "activateTrigger" && action.uid === ragweed!.uid);
    expect(ragweedAction).toBeDefined();
    applyAndAssert(session, ragweedAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.cards.find((card) => card.uid === ragweed!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: ragweed!.uid,
      targetPlayer: 1,
      targetParam: 2,
      operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 1, parameter: 2 }],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toMatchObject({
      sourceUid: ragweed!.uid,
      targetPlayer: 1,
      targetParam: 2,
      operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 1, parameter: 2 }],
    });

    const passRagweed = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(passRagweed).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, passRagweed!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === ragweedDrawn!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === ragweedDrawnSecond!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === ragweed!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "cardsDrawn", eventCode: 1110, eventPlayer: 0, eventValue: 2, eventUids: [opponentDrawn!.uid, opponentDrawnSecond!.uid] }),
        expect.objectContaining({ eventName: "cardsDrawn", eventCode: 1110, eventPlayer: 1, eventValue: 2, eventUids: [ragweedDrawnSecond!.uid, ragweedDrawn!.uid] }),
      ]),
    );
    expect(restored.host.messages).not.toContain("naturia ragweed chain responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("naturia ragweed chain responder resolved") end)
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
