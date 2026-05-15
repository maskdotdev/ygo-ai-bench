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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dark Bribe negate draw", () => {
  it("restores activation negation that destroys the source, draws for the opponent, and suppresses the negated Spell", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const darkBribeCode = "77538567";
    const upstartCode = "70368879";
    const drawnCode = "923";
    const responderCode = "924";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [darkBribeCode, upstartCode].includes(card.code)),
      { code: drawnCode, name: "Dark Bribe Drawn Card", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Dark Bribe Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 476, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [upstartCode, drawnCode, responderCode] }, 1: { main: [darkBribeCode] } });
    startDuel(session);

    const upstart = session.state.cards.find((card) => card.code === upstartCode);
    const drawn = session.state.cards.find((card) => card.code === drawnCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const darkBribe = session.state.cards.find((card) => card.code === darkBribeCode);
    expect(upstart).toBeDefined();
    expect(drawn).toBeDefined();
    expect(responder).toBeDefined();
    expect(darkBribe).toBeDefined();
    moveDuelCard(session.state, upstart!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, darkBribe!.uid, "spellTrapZone", 1);
    darkBribe!.position = "faceDown";
    darkBribe!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(upstartCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(darkBribeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const upstartAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === upstart!.uid);
    expect(upstartAction).toBeDefined();
    applyAndAssert(session, upstartAction!);
    expect(session.state.chain).toHaveLength(1);

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenChain.restoreComplete, restoredOpenChain.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredOpenChain, 1);
    expect(restoredOpenChain.missingRegistryKeys).toEqual([]);
    const darkBribeAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === darkBribe!.uid);
    expect(darkBribeAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredOpenChain, darkBribeAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredOpenChain.session.state.chain).toHaveLength(2);
    expect(restoredOpenChain.session.state.chain[1]).toMatchObject({
      sourceUid: darkBribe!.uid,
      operationInfos: [
        { category: 0x10000000, targetUids: [upstart!.uid], count: 1, player: 0, parameter: 0 },
        { category: 0x1, targetUids: [upstart!.uid], count: 1, player: 0, parameter: 0 },
        { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 },
      ],
    });

    const restoredPendingResolution = restoreDuelWithLuaScripts(serializeDuel(restoredOpenChain.session), source, reader);
    expect(restoredPendingResolution.restoreComplete, restoredPendingResolution.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredPendingResolution, 0);
    expect(restoredPendingResolution.missingRegistryKeys).toEqual([]);

    for (let index = 0; index < 4 && restoredPendingResolution.session.state.chain.length > 0; index += 1) {
      const passPlayer = restoredPendingResolution.session.state.waitingFor;
      expect(passPlayer).toBeDefined();
      const pass = getLuaRestoreLegalActions(restoredPendingResolution, passPlayer!).find((action) => action.type === "passChain");
      expect(pass).toBeDefined();
      const resolved = applyLuaRestoreResponse(restoredPendingResolution, pass!);
      expect(resolved.ok, resolved.error).toBe(true);
    }

    expect(restoredPendingResolution.session.state.chain).toHaveLength(0);
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === upstart!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === darkBribe!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === drawn!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredPendingResolution.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredPendingResolution.host.messages).not.toContain("dark bribe chain responder resolved");
    expect(restoredPendingResolution.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "destroyed", eventCode: 1029, eventCardUid: upstart!.uid }),
        expect.objectContaining({ eventName: "cardsDrawn", eventCode: 1110, eventPlayer: 0, eventUids: [drawn!.uid] }),
        expect.objectContaining({ eventName: "chainNegated", eventCode: 1024, eventPlayer: 0 }),
        expect.objectContaining({ eventName: "chainDisabled", eventCode: 1025, eventPlayer: 0 }),
      ]),
    );
    expect(restoredPendingResolution.session.state.eventHistory).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "recoveredLifePoints", eventCode: 1112, eventPlayer: 1, eventValue: 1000 })]),
    );
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
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>1 end)
      e:SetOperation(function(e,tp) Debug.Message("dark bribe chain responder resolved") end)
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
