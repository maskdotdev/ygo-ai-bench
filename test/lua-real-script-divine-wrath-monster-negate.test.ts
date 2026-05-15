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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Divine Wrath monster negation", () => {
  it("restores a Counter Trap response that discards, negates a monster effect, destroys its source, and suppresses its operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const divineWrathCode = "49010598";
    const starterCode = "916";
    const drawnCode = "917";
    const responderCode = "918";
    const discardCode = "919";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === divineWrathCode),
      { code: starterCode, name: "Divine Wrath Monster Effect", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: drawnCode, name: "Divine Wrath Drawn Card", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Divine Wrath Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: discardCode, name: "Divine Wrath Discard Cost", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 474, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterCode, drawnCode, responderCode] }, 1: { main: [divineWrathCode, discardCode] } });
    startDuel(session);

    const starter = session.state.cards.find((card) => card.code === starterCode);
    const drawn = session.state.cards.find((card) => card.code === drawnCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const divineWrath = session.state.cards.find((card) => card.code === divineWrathCode);
    const discard = session.state.cards.find((card) => card.code === discardCode);
    expect(starter).toBeDefined();
    expect(drawn).toBeDefined();
    expect(responder).toBeDefined();
    expect(divineWrath).toBeDefined();
    expect(discard).toBeDefined();
    moveDuelCard(session.state, starter!.uid, "monsterZone", 0);
    starter!.position = "faceUpAttack";
    starter!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, divineWrath!.uid, "spellTrapZone", 1);
    divineWrath!.position = "faceDown";
    divineWrath!.faceUp = false;
    moveDuelCard(session.state, discard!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return monsterDrawScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(divineWrathCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: starter!.uid,
      operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 }],
    });

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenChain.restoreComplete, restoredOpenChain.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredOpenChain, 1);
    expect(restoredOpenChain.missingRegistryKeys).toEqual([]);
    expect(restoredOpenChain.missingChainLimitRegistryKeys).toEqual([]);
    const divineWrathAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === divineWrath!.uid);
    expect(divineWrathAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredOpenChain, divineWrathAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === discard!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredOpenChain.session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "discarded", eventCode: 1018, eventCardUid: discard!.uid })]));
    expect(restoredOpenChain.session.state.chain).toHaveLength(2);
    expect(restoredOpenChain.session.state.chain[1]).toMatchObject({
      sourceUid: divineWrath!.uid,
      operationInfos: [
        { category: 0x10000000, targetUids: [starter!.uid], count: 1, player: 0, parameter: 0 },
        { category: 0x1, targetUids: [starter!.uid], count: 1, player: 0, parameter: 0 },
      ],
    });

    const restoredPendingResolution = restoreDuelWithLuaScripts(serializeDuel(restoredOpenChain.session), source, reader);
    expect(restoredPendingResolution.restoreComplete, restoredPendingResolution.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredPendingResolution, 0);
    expect(restoredPendingResolution.missingRegistryKeys).toEqual([]);
    expect(restoredPendingResolution.missingChainLimitRegistryKeys).toEqual([]);

    for (let index = 0; index < 4 && restoredPendingResolution.session.state.chain.length > 0; index += 1) {
      const passPlayer = restoredPendingResolution.session.state.waitingFor;
      expect(passPlayer).toBeDefined();
      const pass = getLuaRestoreLegalActions(restoredPendingResolution, passPlayer!).find((action) => action.type === "passChain");
      expect(pass).toBeDefined();
      const resolved = applyLuaRestoreResponse(restoredPendingResolution, pass!);
      expect(resolved.ok, resolved.error).toBe(true);
    }

    expect(restoredPendingResolution.session.state.chain).toHaveLength(0);
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === starter!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === divineWrath!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === discard!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === drawn!.uid)).toMatchObject({ location: "deck" });
    expect(restoredPendingResolution.host.messages).not.toContain("divine wrath monster effect resolved");
    expect(restoredPendingResolution.host.messages).not.toContain("divine wrath chain responder resolved");
    expect(restoredPendingResolution.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "destroyed", eventCode: 1029, eventCardUid: starter!.uid }),
        expect.objectContaining({ eventName: "chainNegated", eventCode: 1024, eventPlayer: 0 }),
        expect.objectContaining({ eventName: "chainDisabled", eventCode: 1025, eventPlayer: 0 }),
      ]),
    );
    expect(restoredPendingResolution.session.state.eventHistory).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "cardsDrawn", eventCode: 1110, eventPlayer: 0, eventUids: [drawn!.uid] })]),
    );
  });
});

function monsterDrawScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Duel.Draw(tp,1,REASON_EFFECT)
        Debug.Message("divine wrath monster effect resolved")
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
      e:SetOperation(function(e,tp) Debug.Message("divine wrath chain responder resolved") end)
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
