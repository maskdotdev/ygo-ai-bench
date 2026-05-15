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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Seven Tools trap negation", () => {
  it("restores an LP-cost Counter Trap response that negates and destroys a Trap activation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sevenToolsCode = "3819470";
    const starterTrapCode = "920";
    const drawnCode = "921";
    const responderCode = "922";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sevenToolsCode),
      { code: starterTrapCode, name: "Seven Tools Trap Effect", kind: "trap", typeFlags: 0x4 },
      { code: drawnCode, name: "Seven Tools Drawn Card", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Seven Tools Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 475, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterTrapCode, drawnCode, responderCode] }, 1: { main: [sevenToolsCode] } });
    startDuel(session);

    const starterTrap = session.state.cards.find((card) => card.code === starterTrapCode);
    const drawn = session.state.cards.find((card) => card.code === drawnCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const sevenTools = session.state.cards.find((card) => card.code === sevenToolsCode);
    expect(starterTrap).toBeDefined();
    expect(drawn).toBeDefined();
    expect(responder).toBeDefined();
    expect(sevenTools).toBeDefined();
    moveDuelCard(session.state, starterTrap!.uid, "spellTrapZone", 0);
    starterTrap!.position = "faceDown";
    starterTrap!.faceUp = false;
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, sevenTools!.uid, "spellTrapZone", 1);
    sevenTools!.position = "faceDown";
    sevenTools!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterTrapCode}.lua`) return trapDrawScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(starterTrapCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(sevenToolsCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starterTrap!.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: starterTrap!.uid,
      operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 }],
    });

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenChain.restoreComplete, restoredOpenChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpenChain.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredOpenChain, 1);
    const sevenToolsAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === sevenTools!.uid);
    expect(sevenToolsAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredOpenChain, sevenToolsAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredOpenChain.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredOpenChain.session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "lifePointCostPaid", eventCode: 1201, eventPlayer: 1, eventValue: 1000, eventReason: 0x80, eventReasonPlayer: 1 })]),
    );
    expect(restoredOpenChain.session.state.chain).toHaveLength(2);
    expect(restoredOpenChain.session.state.chain[1]).toMatchObject({
      sourceUid: sevenTools!.uid,
      operationInfos: [
        { category: 0x10000000, targetUids: [starterTrap!.uid], count: 1, player: 0, parameter: 0 },
        { category: 0x1, targetUids: [starterTrap!.uid], count: 1, player: 0, parameter: 0 },
      ],
    });

    const restoredPendingResolution = restoreDuelWithLuaScripts(serializeDuel(restoredOpenChain.session), source, reader);
    expect(restoredPendingResolution.restoreComplete, restoredPendingResolution.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPendingResolution.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredPendingResolution, 0)).toEqual(getGroupedDuelLegalActions(restoredPendingResolution.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredPendingResolution, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredPendingResolution, 0));

    for (let index = 0; index < 4 && restoredPendingResolution.session.state.chain.length > 0; index += 1) {
      const passPlayer = restoredPendingResolution.session.state.waitingFor;
      expect(passPlayer).toBeDefined();
      const pass = getLuaRestoreLegalActions(restoredPendingResolution, passPlayer!).find((action) => action.type === "passChain");
      expect(pass).toBeDefined();
      const resolved = applyLuaRestoreResponse(restoredPendingResolution, pass!);
      expect(resolved.ok, resolved.error).toBe(true);
    }

    expect(restoredPendingResolution.session.state.chain).toHaveLength(0);
    expect(restoredPendingResolution.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === starterTrap!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === sevenTools!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === drawn!.uid)).toMatchObject({ location: "deck" });
    expect(restoredPendingResolution.host.messages).not.toContain("seven tools trap effect resolved");
    expect(restoredPendingResolution.host.messages).not.toContain("seven tools chain responder resolved");
    expect(restoredPendingResolution.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "destroyed", eventCode: 1029, eventCardUid: starterTrap!.uid }),
        expect.objectContaining({ eventName: "chainNegated", eventCode: 1024, eventPlayer: 0 }),
        expect.objectContaining({ eventName: "chainDisabled", eventCode: 1025, eventPlayer: 0 }),
      ]),
    );
    expect(restoredPendingResolution.session.state.eventHistory).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "cardsDrawn", eventCode: 1110, eventPlayer: 0, eventUids: [drawn!.uid] })]),
    );
  });
});

function trapDrawScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Duel.Draw(tp,1,REASON_EFFECT)
        Debug.Message("seven tools trap effect resolved")
      end)
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
      e:SetOperation(function(e,tp) Debug.Message("seven tools chain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
