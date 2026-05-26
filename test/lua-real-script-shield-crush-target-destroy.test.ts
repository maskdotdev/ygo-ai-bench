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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Shield Crush target destroy", () => {
  it("restores Shield Crush's selected defense target and destroys it on resolution", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const shieldCrushCode = "30683373";
    const targetId = "30683374";
    const attackSurvivorId = "30683375";
    const responderId = "30683376";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === shieldCrushCode),
      { code: targetId, name: "Shield Crush Set Defense Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 2100 },
      { code: attackSurvivorId, name: "Shield Crush Attack Survivor", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1700, defense: 1200 },
      { code: responderId, name: "Shield Crush Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 306, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [shieldCrushCode] }, 1: { main: [targetId, attackSurvivorId, responderId] } });
    startDuel(session);

    const shieldCrush = session.state.cards.find((card) => card.code === shieldCrushCode);
    const target = session.state.cards.find((card) => card.code === targetId);
    const attackSurvivor = session.state.cards.find((card) => card.code === attackSurvivorId);
    const responder = session.state.cards.find((card) => card.code === responderId);
    expect(shieldCrush).toBeDefined();
    expect(target).toBeDefined();
    expect(attackSurvivor).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, shieldCrush!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);
    target!.position = "faceDownDefense";
    target!.faceUp = false;
    moveDuelCard(session.state, attackSurvivor!.uid, "monsterZone", 1);
    attackSurvivor!.position = "faceUpAttack";
    attackSurvivor!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderId}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(shieldCrushCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderId), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const shieldAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === shieldCrush!.uid);
    expect(shieldAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, shieldAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      id: "chain-2",
      operationInfos: [{ category: 0x1, count: 1, parameter: 0, player: 0, targetUids: [target!.uid] }],
      player: 0,
      sourceUid: shieldCrush!.uid,
      targetFieldIds: [6],
      targetUids: [target!.uid],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toEqual({
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      id: "chain-2",
      operationInfos: [{ category: 0x1, count: 1, parameter: 0, player: 0, targetUids: [target!.uid] }],
      player: 0,
      sourceUid: shieldCrush!.uid,
      targetFieldIds: [6],
      targetUids: [target!.uid],
    });

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === shieldCrush!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      position: "faceDownDefense",
      faceUp: true,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: shieldCrush!.uid,
    });
    expect(restored.session.state.cards.find((card) => card.uid === attackSurvivor!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      position: "faceUpAttack",
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: shieldCrush!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "monsterZone",
          position: "faceDownDefense",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceDownDefense",
          sequence: 0,
        },
      },
    ]);
    expect(restored.host.messages).not.toContain("shield crush responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("shield crush responder resolved") end)
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
