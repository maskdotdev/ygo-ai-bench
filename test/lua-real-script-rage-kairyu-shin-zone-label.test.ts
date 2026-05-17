import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { availableMonsterZoneCount } from "#lua/duel-api/location.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeWater = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Rage of Kairyu-Shin zone label", () => {
  it("restores its target destroy and materializes the previous-zone disable label", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const rageCode = "82685480";
    const umiCode = "22702055";
    const ownWaterCode = "82685481";
    const responderCode = "82685482";
    const opponentTargetCode = "82685483";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === rageCode || card.code === umiCode),
      { code: ownWaterCode, name: "Rage WATER Level 5", kind: "monster", typeFlags: typeMonster | typeEffect, level: 5, attribute: attributeWater, attack: 1800, defense: 1500 },
      { code: responderCode, name: "Rage Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: opponentTargetCode, name: "Rage Previous Zone Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8268, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rageCode, umiCode, ownWaterCode] }, 1: { main: [responderCode, opponentTargetCode] } });
    startDuel(session);

    const rage = requireCard(session, rageCode);
    const umi = requireCard(session, umiCode);
    const ownWater = requireCard(session, ownWaterCode);
    const responder = requireCard(session, responderCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    moveDuelCard(session.state, rage.uid, "spellTrapZone", 0).sequence = 0;
    rage.faceUp = false;
    rage.position = "faceDown";
    moveDuelCard(session.state, umi.uid, "spellTrapZone", 0).sequence = 5;
    umi.faceUp = true;
    moveDuelCard(session.state, ownWater.uid, "monsterZone", 0).sequence = 0;
    ownWater.faceUp = true;
    ownWater.position = "faceUpAttack";
    moveDuelCard(session.state, opponentTarget.uid, "monsterZone", 1).sequence = 2;
    opponentTarget.faceUp = true;
    opponentTarget.position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(rageCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const rageAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === rage.uid);
    expect(rageAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, rageAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "spellTrapZone",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      id: "chain-2",
      player: 0,
      sourceUid: rage.uid,
      targetUids: [opponentTarget.uid],
      operationInfos: [
        { category: 0x1, targetUids: [opponentTarget.uid], count: 1, player: 0, parameter: 0 },
      ],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [opponentTarget.uid], count: 1, player: 0, parameter: 0 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      previousSequence: 2,
    });
    expect(restored.session.state.cards.find((card) => card.uid === rage.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === opponentTarget.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentTarget.uid,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 2,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: rage.uid,
        eventReasonEffectId: 1,
      },
    ]);
    const disableFieldEffects = restored.session.state.effects.filter((effect) => effect.sourceUid === rage.uid && effect.code === 260);
    expect(disableFieldEffects).toHaveLength(1);
    expect(disableFieldEffects[0]).toMatchObject({ code: 260, sourceUid: rage.uid, value: 1 << 18 });
    expect(availableMonsterZoneCount(restored.session, 1, [])).toBe(4);
    expect(restored.host.messages).not.toContain("rage responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("rage responder resolved") end)
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
