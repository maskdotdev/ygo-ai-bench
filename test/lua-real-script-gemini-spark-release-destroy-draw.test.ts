import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gemini Spark", () => {
  it("restores its Gemini release cost, target destruction, and draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sparkCode = "33846209";
    const geminiCode = "16146511";
    const targetCode = "929";
    const drawnCode = "930";
    const responderCode = "931";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [sparkCode, geminiCode].includes(card.code)),
      { code: targetCode, name: "Gemini Spark Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1000 },
      { code: drawnCode, name: "Gemini Spark Drawn Card", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Gemini Spark Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 313, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sparkCode, geminiCode, drawnCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const spark = session.state.cards.find((card) => card.code === sparkCode);
    const gemini = session.state.cards.find((card) => card.code === geminiCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const drawn = session.state.cards.find((card) => card.code === drawnCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(spark).toBeDefined();
    expect(gemini).toBeDefined();
    expect(target).toBeDefined();
    expect(drawn).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, spark!.uid, "hand", 0);
    moveDuelCard(session.state, gemini!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    gemini!.faceUp = true;
    gemini!.position = "faceUpAttack";
    target!.faceUp = true;
    target!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sparkCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === spark!.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restored, activate!);
    expect(activated.ok, activated.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === gemini!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toMatchObject({ sourceUid: spark!.uid });
    expect(restored.session.state.chain[0]!.operationInfos).toEqual(
      expect.arrayContaining([
        { category: 0x1, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 },
        { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 },
      ]),
    );

    const chainRestored = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(chainRestored.restoreComplete, chainRestored.incompleteReasons.join("; ")).toBe(true);
    expect(chainRestored.missingRegistryKeys).toEqual([]);
    expect(chainRestored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(chainRestored, 1);
    expect(getLuaRestoreLegalActions(chainRestored, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(chainRestored, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(chainRestored, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(chainRestored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(chainRestored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(chainRestored.session.state.cards.find((card) => card.uid === drawn!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(chainRestored.session.state.cards.find((card) => card.uid === spark!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(chainRestored.session.state.eventHistory.filter((event) => ["released", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: gemini!.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: spark!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: drawn!.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [drawn!.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: spark!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(chainRestored.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === target!.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 1,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 1,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: spark!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(chainRestored.host.messages).not.toContain("gemini spark responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("gemini spark responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
