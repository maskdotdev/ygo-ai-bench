import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Black Horn of Heaven Special Summon negation", () => {
  it("restores Black Horn of Heaven's opponent-only Special Summon negation and cleanup", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const hornCode = "50323155";
    const summonedCode = "966";
    const responderCode = "967";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === hornCode),
      { code: summonedCode, name: "Black Horn Special Summoned Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1900, defense: 1100 },
      { code: responderCode, name: "Black Horn Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 489, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [summonedCode, responderCode] }, 1: { main: [hornCode] } });
    startDuel(session);

    const summoned = session.state.cards.find((card) => card.code === summonedCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const horn = session.state.cards.find((card) => card.code === hornCode);
    expect(summoned).toBeDefined();
    expect(responder).toBeDefined();
    expect(horn).toBeDefined();
    moveDuelCard(session.state, summoned!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, horn!.uid, "spellTrapZone", 1);
    horn!.position = "faceDown";
    horn!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hornCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    specialSummonDuelCard(session.state, summoned!.uid, 0);
    expect(session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, position: "faceUpAttack" });
    expect(session.state.pendingTriggers).toEqual([expect.objectContaining({ eventName: "specialSummoning", eventCode: 1105, eventCardUid: summoned!.uid, eventReasonPlayer: 0 })]);
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "specialSummoning", eventCode: 1105, eventCardUid: summoned!.uid, eventReasonPlayer: 0 }),
        expect.objectContaining({ eventName: "specialSummoned", eventCode: 1102, eventCardUid: summoned!.uid, eventReasonPlayer: 0 }),
      ]),
    );

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredSummonWindow.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredSummonWindow, 1));
    const hornAction = getLuaRestoreLegalActions(restoredSummonWindow, 1).find((action) => action.type === "activateTrigger" && action.uid === horn!.uid);
    expect(hornAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredSummonWindow, hornAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredSummonWindow.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredSummonWindow.session.state.chain).toHaveLength(1);
    expect(restoredSummonWindow.session.state.chain[0]).toMatchObject({
      sourceUid: horn!.uid,
      eventName: "specialSummoning",
      eventCode: 1105,
      eventCardUid: summoned!.uid,
      operationInfos: [
        { category: 0x8000, targetUids: [summoned!.uid], count: 1, player: 0, parameter: 0 },
        { category: 0x1, targetUids: [summoned!.uid], count: 1, player: 0, parameter: 0 },
      ],
    });

    const restoredPendingResolution = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredPendingResolution.restoreComplete, restoredPendingResolution.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPendingResolution.missingRegistryKeys).toEqual([]);
    expect(restoredPendingResolution.missingChainLimitRegistryKeys).toEqual([]);
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
    expect(restoredPendingResolution.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === horn!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.host.messages).not.toContain("black horn chain responder resolved");
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["specialSummonNegated", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummonNegated",
        eventCode: 1116,
        eventCardUid: summoned!.uid,
        eventReason: duelReason.disSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: horn!.uid,
        eventReasonEffectId: 2,
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
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: summoned!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: horn!.uid,
        eventReasonEffectId: 2,
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
    ]);
    expect(restoredPendingResolution.session.state.eventHistory).not.toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "specialSummoned", eventCardUid: summoned!.uid })]));
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
      e:SetOperation(function(e,tp) Debug.Message("black horn chain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
