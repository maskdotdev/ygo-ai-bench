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
const categoryDamage = 0x80000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Castle Gate release-cost damage", () => {
  it("restores Castle Gate's released monster ATK label into effect damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const castleGateCode = "36931229";
    const releaseMaterialCode = "36931230";
    const responderCode = "36931231";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === castleGateCode),
      { code: releaseMaterialCode, name: "Castle Gate Release Material", kind: "monster", typeFlags: 0x1, level: 4, attack: 1700, defense: 1000 },
      { code: responderCode, name: "Castle Gate Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 369, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [castleGateCode, releaseMaterialCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const castleGate = requireCard(session, castleGateCode);
    const releaseMaterial = requireCard(session, releaseMaterialCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, castleGate.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, releaseMaterial.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const { source, host } = loadCastleGateHost(session, workspace, castleGateCode, responderCode);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === castleGate.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.cards.find((card) => card.uid === releaseMaterial.uid)).toMatchObject({
      location: "graveyard",
      reason: 0x82,
    });
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: castleGate.uid,
      effectLabel: 1700,
      targetPlayer: 1,
      targetParam: 1700,
      operationInfos: [{ category: categoryDamage, count: 0, player: 1, parameter: 1700 }],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain[0]).toMatchObject({
      sourceUid: castleGate.uid,
      effectLabel: 1700,
      targetPlayer: 1,
      targetParam: 1700,
      operationInfos: [{ category: categoryDamage, count: 0, player: 1, parameter: 1700 }],
    });

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.players[1].lifePoints).toBe(6300);
    expect(restored.session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "released", eventCardUid: releaseMaterial.uid })]));
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1700,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: castleGate.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(host.messages).not.toContain("castle gate responder resolved");
    expect(restored.host.messages).not.toContain("castle gate responder resolved");
  });
});

function loadCastleGateHost(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, castleGateCode: string, responderCode: string) {
  const source = {
    readScript(name: string) {
      if (name === `c${responderCode}.lua`) return chainResponderScript();
      return workspace.readScript(name);
    },
  };
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(castleGateCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return { source, host };
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
      e:SetOperation(function(e,tp) Debug.Message("castle gate responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
