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
const typeSpell = 0x2;
const typeContinuous = 0x20000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Seismic Crasher continuous-cost damage", () => {
  it("restores Seismic Crasher's continuous Spell/Trap cost and target-param damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const seismicCrasherCode = "114932";
    const continuousCostCode = "114933";
    const normalSpellDecoyCode = "114934";
    const responderCode = "114935";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === seismicCrasherCode),
      { code: continuousCostCode, name: "Seismic Crasher Continuous Cost", kind: "spell", typeFlags: typeSpell | typeContinuous },
      { code: normalSpellDecoyCode, name: "Seismic Crasher Normal Spell Decoy", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Seismic Crasher Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 114932, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [seismicCrasherCode, continuousCostCode, normalSpellDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const seismicCrasher = requireCard(session, seismicCrasherCode);
    const continuousCost = requireCard(session, continuousCostCode);
    const normalSpellDecoy = requireCard(session, normalSpellDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, seismicCrasher.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, normalSpellDecoy.uid, "spellTrapZone", 0);
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
    expect(host.loadCardScript(Number(seismicCrasherCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(getLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.uid === seismicCrasher.uid)).toBe(false);

    moveDuelCard(session.state, continuousCost.uid, "spellTrapZone", 0).sequence = 1;
    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === seismicCrasher.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    expect(session.state.cards.find((card) => card.uid === continuousCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
    });
    expect(session.state.cards.find((card) => card.uid === normalSpellDecoy.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
    });
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "monsterZone",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1",
      id: "chain-3",
      operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 500 }],
      player: 0,
      sourceUid: seismicCrasher.uid,
      targetParam: 500,
      targetPlayer: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.chain[0]).toEqual({
      activationLocation: "monsterZone",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1",
      id: "chain-3",
      operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 500 }],
      player: 0,
      sourceUid: seismicCrasher.uid,
      targetParam: 500,
      targetPlayer: 1,
    });
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    passChain(restored);

    expect(restored.session.state.chain).toHaveLength(0);
    expect(restored.session.state.players[1].lifePoints).toBe(7500);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === continuousCost.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: continuousCost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: seismicCrasher.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: seismicCrasher.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(host.messages).not.toContain("seismic crasher responder resolved");
    expect(restored.host.messages).not.toContain("seismic crasher responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("seismic crasher responder resolved") end)
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
