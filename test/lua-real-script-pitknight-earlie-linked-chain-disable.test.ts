import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { currentAttack } from "#duel/card-stats.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Pitknight Earlie linked chain disable", () => {
  it("restores its bit.extract linked-zone chain condition and disables the selected monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const pitknightCode = "47759571";
    const starterCode = "47759572";
    const responderCode = "47759574";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === pitknightCode),
      { code: starterCode, name: "Pitknight Linked Monster Effect", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
      { code: responderCode, name: "Pitknight Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4775, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [pitknightCode] }, 1: { main: [starterCode, responderCode] } });
    startDuel(session);

    const pitknight = requireCard(session, pitknightCode);
    const starter = requireCard(session, starterCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, pitknight.uid, "monsterZone", 0).sequence = 0;
    pitknight.faceUp = true;
    pitknight.position = "faceUpAttack";
    moveDuelCard(session.state, starter.uid, "monsterZone", 1).sequence = 1;
    starter.faceUp = true;
    starter.position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return starterScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(pitknightCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "monsterZone",
      activationSequence: 1,
      chainIndex: 1,
      effectId: "lua-4",
      id: "chain-2",
      operationInfos: [
        { category: 0x10000, targetUids: [], count: 0, player: 1, parameter: 1 },
      ],
      player: 1,
      sourceUid: starter.uid,
    });

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenChain.restoreComplete, restoredOpenChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpenChain.missingRegistryKeys).toEqual([]);
    expect(restoredOpenChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredOpenChain, 0);
    const pitknightAction = getLuaRestoreLegalActions(restoredOpenChain, 0).find((action) => action.type === "activateEffect" && action.uid === pitknight.uid);
    expect(pitknightAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpenChain, 0), null, 2)).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredOpenChain, pitknightAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredOpenChain.session.state.chain).toHaveLength(2);
    expect(restoredOpenChain.session.state.chain[1]).toEqual({
      activationLocation: "monsterZone",
      activationSequence: 0,
      chainIndex: 2,
      effectId: "lua-2-1027",
      eventCardUid: starter.uid,
      eventChainDepth: 1,
      eventChainLinkId: "chain-2",
      eventCode: 1027,
      eventCurrentState: {
        controller: 1,
        faceUp: true,
        location: "monsterZone",
        position: "faceUpAttack",
        sequence: 1,
      },
      eventName: "chaining",
      eventPlayer: 1,
      eventPreviousState: {
        controller: 1,
        faceUp: false,
        location: "deck",
        position: "faceDown",
        sequence: 1,
      },
      eventReasonPlayer: 1,
      eventValue: 1,
      id: "chain-3",
      player: 0,
      sourceUid: pitknight.uid,
      targetFieldIds: [5],
      targetUids: [starter.uid],
    });

    const restoredPendingResolution = restoreDuelWithLuaScripts(serializeDuel(restoredOpenChain.session), source, reader);
    expect(restoredPendingResolution.restoreComplete, restoredPendingResolution.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPendingResolution.missingRegistryKeys).toEqual([]);
    expect(restoredPendingResolution.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredPendingResolution, 1);

    for (let index = 0; index < 4 && restoredPendingResolution.session.state.chain.length > 0; index += 1) {
      const passPlayer = restoredPendingResolution.session.state.waitingFor;
      expect(passPlayer).toBeDefined();
      const pass = getLuaRestoreLegalActions(restoredPendingResolution, passPlayer!).find((action) => action.type === "passChain");
      expect(pass).toBeDefined();
      const resolved = applyLuaRestoreResponse(restoredPendingResolution, pass!);
      expect(resolved.ok, resolved.error).toBe(true);
    }

    const restoredStarter = restoredPendingResolution.session.state.cards.find((card) => card.uid === starter.uid);
    expect(restoredPendingResolution.session.state.chain).toHaveLength(0);
    expect(restoredPendingResolution.host.messages).not.toContain("pitknight responder resolved");
    expect(restoredPendingResolution.host.messages).not.toContain("pitknight linked starter resolved");
    expect(restoredStarter).toMatchObject({ location: "monsterZone", controller: 1, sequence: 1, faceUp: true });
    expect(currentAttack(restoredStarter, restoredPendingResolution.session.state)).toBe(0);
    expect(restoredPendingResolution.session.state.effects.filter((effect) => effect.sourceUid === starter.uid).map((effect) => effect.code).filter((code) => code !== undefined).sort((left, right) => left - right)).toEqual([2, 8, 102]);
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn")).toEqual([]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function starterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp) Debug.Message("pitknight linked starter resolved") Duel.Draw(tp,1,REASON_EFFECT) end)
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
      e:SetOperation(function(e,tp) Debug.Message("pitknight responder resolved") end)
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
