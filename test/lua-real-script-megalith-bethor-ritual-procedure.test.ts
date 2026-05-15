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
const setMegalith = 0x138;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Megalith Bethor ritual procedure", () => {
  it("restores Bethor's Ritual.Target and Ritual.Operation helper summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const bethorCode = "99628747";
    const ritualTargetCode = "9962";
    const materialACode = "9963";
    const materialBCode = "9964";
    const responderCode = "9965";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === bethorCode),
      { code: ritualTargetCode, name: "Megalith Ritual Target Fixture", kind: "monster", typeFlags: 0x81, level: 8, attack: 2500, defense: 1800, setcodes: [setMegalith] },
      { code: materialACode, name: "Megalith Ritual Material A Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1000 },
      { code: materialBCode, name: "Megalith Ritual Material B Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1300, defense: 1000 },
      { code: responderCode, name: "Megalith Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 996, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [bethorCode, ritualTargetCode, materialACode, materialBCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const bethor = session.state.cards.find((card) => card.code === bethorCode);
    const ritualTarget = session.state.cards.find((card) => card.code === ritualTargetCode);
    const materialA = session.state.cards.find((card) => card.code === materialACode);
    const materialB = session.state.cards.find((card) => card.code === materialBCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(bethor).toBeDefined();
    expect(ritualTarget).toBeDefined();
    expect(materialA).toBeDefined();
    expect(materialB).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, bethor!.uid, "hand", 0);
    moveDuelCard(session.state, ritualTarget!.uid, "hand", 0);
    moveDuelCard(session.state, materialA!.uid, "hand", 0);
    moveDuelCard(session.state, materialB!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bethorCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === bethor!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: bethor!.uid,
      operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }],
    });
    expect(session.state.cards.find((card) => card.uid === bethor!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.discard | duelReason.cost,
      reasonPlayer: 0,
    });
    expect(session.state.cards.find((card) => card.uid === ritualTarget!.uid)).toMatchObject({ location: "hand", controller: 0 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chain[0]).toMatchObject({
      sourceUid: bethor!.uid,
      operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }],
    });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === ritualTarget!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "ritual",
      summonMaterialUids: [materialA!.uid, materialB!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === materialA!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.material | duelReason.ritual,
    });
    expect(restored.session.state.cards.find((card) => card.uid === materialB!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.material | duelReason.ritual,
    });
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "specialSummoned", eventCardUid: ritualTarget!.uid, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.ritual })]),
    );
    expect(restored.host.messages).not.toContain("megalith responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("megalith responder resolved") end)
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
