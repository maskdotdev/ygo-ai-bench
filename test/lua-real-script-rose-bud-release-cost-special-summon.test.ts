import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { hasProcedureCompleteStatus, statusProcComplete } from "#duel/procedure-status.js";
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
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Rose Bud release-cost Special Summon", () => {
  it("restores Rose Bud's release-group cost and hand/deck Special Summon operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const roseBudCode = "25090294";
    const releaseCostCode = "62107981";
    const summonTargetCode = "51085303";
    const releaseDecoyCode = "25090295";
    const summonDecoyCode = "25090296";
    const responderCode = "25090297";
    const roseBudScript = workspace.readScript(`c${roseBudCode}.lua`);
    expect(roseBudScript).toContain("Duel.CheckReleaseGroupCost");
    expect(roseBudScript).toContain("Duel.SelectReleaseGroupCost");
    expect(roseBudScript).toContain("Duel.Release(g,REASON_COST)");
    expect(roseBudScript).toContain("Duel.SpecialSummon(tc,0,tp,tp,true,false,POS_FACEUP)");
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === roseBudCode),
      { code: releaseCostCode, name: "Rose Bud Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 800, defense: 800 },
      { code: summonTargetCode, name: "Rose Bud Special Summon Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
      { code: releaseDecoyCode, name: "Rose Bud Release Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 900 },
      { code: summonDecoyCode, name: "Rose Bud Summon Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Rose Bud Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 25090294, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [roseBudCode, releaseCostCode, summonTargetCode, releaseDecoyCode, summonDecoyCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const roseBud = requireCard(session, roseBudCode);
    const releaseCost = requireCard(session, releaseCostCode);
    const summonTarget = requireCard(session, summonTargetCode);
    const releaseDecoy = requireCard(session, releaseDecoyCode);
    const summonDecoy = requireCard(session, summonDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, roseBud.uid, "hand", 0);
    moveDuelCard(session.state, releaseDecoy.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(roseBudCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(getLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.uid === roseBud.uid)).toBe(false);

    const movedReleaseCost = moveDuelCard(session.state, releaseCost.uid, "monsterZone", 0);
    movedReleaseCost.sequence = 1;
    movedReleaseCost.position = "faceUpAttack";
    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === roseBud.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    expect(session.state.cards.find((card) => card.uid === releaseCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: roseBud.uid,
    });
    expect(session.state.cards.find((card) => card.uid === releaseDecoy.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 0,
    });
    expect(session.state.cards.find((card) => card.uid === summonDecoy.uid)).toMatchObject({ location: "deck" });
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      effectLabel: 1,
      id: "chain-3",
      operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x3 }],
      player: 0,
      sourceUid: roseBud.uid,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.chain[0]).toEqual({
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      effectLabel: 1,
      id: "chain-3",
      operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x3 }],
      player: 0,
      sourceUid: roseBud.uid,
    });
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    passChain(restored);

    expect(restored.session.state.chain).toHaveLength(0);
    expect(restored.session.state.cards.find((card) => card.uid === roseBud.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === releaseCost.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === releaseDecoy.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === summonDecoy.uid)).toMatchObject({ location: "deck" });
    expect(restored.session.state.cards.find((card) => card.uid === summonTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 1,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      customStatusMask: statusProcComplete,
    });
    expect(hasProcedureCompleteStatus(restored.session.state.cards.find((card) => card.uid === summonTarget.uid)!)).toBe(true);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === releaseCost.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: releaseCost.uid,
        eventReason: duelReason.release | duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: roseBud.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
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
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === summonTarget.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: summonTarget.uid,
        eventUids: [summonTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: roseBud.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 4,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);
    expect(host.messages).not.toContain("rose bud responder resolved");
    expect(restored.host.messages).not.toContain("rose bud responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
      e:SetOperation(function(e,tp) Debug.Message("rose bud responder resolved") end)
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
  }
}
