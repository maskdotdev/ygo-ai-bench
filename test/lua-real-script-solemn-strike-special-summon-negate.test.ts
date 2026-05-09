import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Solemn Strike Special Summon negation", () => {
  it("restores Solemn Strike's Special Summon negation, fixed LP cost, and destroyed-event cleanup", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const strikeCode = "40605147";
    const summonedCode = "927";
    const responderCode = "928";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === strikeCode),
      { code: summonedCode, name: "Solemn Strike Special Summoned Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1900, defense: 1100 },
      { code: responderCode, name: "Solemn Strike Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 478, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [summonedCode, responderCode] }, 1: { main: [strikeCode] } });
    startDuel(session);

    const summoned = session.state.cards.find((card) => card.code === summonedCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const strike = session.state.cards.find((card) => card.code === strikeCode);
    expect(summoned).toBeDefined();
    expect(responder).toBeDefined();
    expect(strike).toBeDefined();
    moveDuelCard(session.state, summoned!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, strike!.uid, "spellTrapZone", 1);
    strike!.position = "faceDown";
    strike!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(strikeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    specialSummonDuelCard(session.state, summoned!.uid, 0);
    expect(session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, position: "faceUpAttack" });
    expect(session.state.pendingTriggers).toEqual([expect.objectContaining({ eventName: "specialSummoning", eventCode: 1105, eventCardUid: summoned!.uid })]);
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "specialSummoning", eventCode: 1105, eventCardUid: summoned!.uid }),
        expect.objectContaining({ eventName: "specialSummoned", eventCode: 1102, eventCardUid: summoned!.uid }),
      ]),
    );

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredSummonWindow.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredSummonWindow, 1));
    const strikeAction = getLuaRestoreLegalActions(restoredSummonWindow, 1).find((action) => action.type === "activateTrigger" && action.uid === strike!.uid);
    expect(strikeAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredSummonWindow, strikeAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredSummonWindow.session.state.players[1].lifePoints).toBe(6500);
    expect(restoredSummonWindow.session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "lifePointCostPaid", eventCode: 1201, eventPlayer: 1, eventValue: 1500, eventReason: 0x80, eventReasonPlayer: 1 })]),
    );
    expect(restoredSummonWindow.session.state.chain).toHaveLength(1);
    expect(restoredSummonWindow.session.state.chain[0]).toMatchObject({
      sourceUid: strike!.uid,
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
    expect(restoredPendingResolution.session.state.players[1].lifePoints).toBe(6500);
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === strike!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.host.messages).not.toContain("solemn strike chain responder resolved");
    expect(restoredPendingResolution.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "specialSummonNegated", eventCode: 1116, eventCardUid: summoned!.uid }),
        expect.objectContaining({ eventName: "destroyed", eventCode: 1029, eventCardUid: summoned!.uid }),
      ]),
    );
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
      e:SetOperation(function(e,tp) Debug.Message("solemn strike chain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
