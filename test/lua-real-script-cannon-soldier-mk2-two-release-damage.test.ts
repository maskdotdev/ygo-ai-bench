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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cannon Soldier MK-2 two-release damage", () => {
  it("restores exact two-monster release cost and fixed player-target damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mk2Code = "14702066";
    const releaseACode = "147020660";
    const releaseBCode = "147020661";
    const responderCode = "147020662";
    const script = workspace.readScript(`c${mk2Code}.lua`);
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,nil,2,false,nil,nil)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,nil,2,2,false,nil,nil)");
    expect(script).toContain("Duel.Release(sg,REASON_COST)");
    expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
    expect(script).toContain("Duel.SetTargetParam(1500)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mk2Code),
      { code: releaseACode, name: "Cannon Soldier MK-2 Release A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: releaseBCode, name: "Cannon Soldier MK-2 Release B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1100, defense: 1000 },
      { code: responderCode, name: "Cannon Soldier MK-2 Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 14702066, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mk2Code, releaseACode, releaseBCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const mk2 = requireCard(session, mk2Code);
    const releaseA = requireCard(session, releaseACode);
    const releaseB = requireCard(session, releaseBCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, mk2.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, releaseA.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, releaseB.uid, "monsterZone", 0).position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(mk2Code), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === mk2.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    const releasedUids = releasedIndividualCostUids(session);
    expect(releasedUids, JSON.stringify(session.state.eventHistory.filter((event) => event.eventName === "released"), null, 2)).toHaveLength(2);
    expect(releasedUids).toContain(mk2.uid);
    expect(releasedUids.some((uid) => uid === releaseA.uid || uid === releaseB.uid)).toBe(true);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "monsterZone",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1",
      id: "chain-4",
      operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 1500 }],
      player: 0,
      sourceUid: mk2.uid,
      targetParam: 1500,
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
      id: "chain-4",
      operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 1500 }],
      player: 0,
      sourceUid: mk2.uid,
      targetParam: 1500,
      targetPlayer: 1,
    });

    passChain(restored);

    expect(restored.session.state.chain).toHaveLength(0);
    expect(restored.session.state.players[1].lifePoints).toBe(6500);
    const firstReleasedUid = releasedUids[0]!;
    const secondReleasedUid = releasedUids[1]!;
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "released" && releasedUids.includes(event.eventCardUid ?? ""))).toEqual([
      releasedEvent(firstReleasedUid, mk2.uid, firstReleasedUid === mk2.uid ? 0 : 1),
      releasedEvent(secondReleasedUid, mk2.uid, secondReleasedUid === mk2.uid ? 0 : 1),
      releasedEvent(firstReleasedUid, mk2.uid, firstReleasedUid === mk2.uid ? 0 : 1, releasedUids),
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: mk2.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(host.messages).not.toContain("cannon soldier mk2 responder resolved");
    expect(restored.host.messages).not.toContain("cannon soldier mk2 responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function releasedIndividualCostUids(session: DuelSession): string[] {
  return session.state.eventHistory
    .filter((event) => (
      event.eventName === "released"
        && event.eventReason === (duelReason.release | duelReason.cost)
        && !event.eventUids
    ))
    .map((event) => event.eventCardUid!)
    .sort();
}

function releasedEvent(uid: string, sourceUid: string, sequence: number, eventUids?: string[]) {
  return {
    eventName: "released",
    eventCode: 1017,
    eventCardUid: uid,
    eventReason: duelReason.release | duelReason.cost,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: {
      controller: 0,
      faceUp: true,
      location: "monsterZone",
      position: "faceUpAttack",
      sequence,
    },
    eventCurrentState: {
      controller: 0,
      faceUp: true,
      location: "graveyard",
      position: "faceUpAttack",
      sequence,
    },
    ...(eventUids ? { eventUids } : {}),
  };
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
      e:SetOperation(function(e,tp) Debug.Message("cannon soldier mk2 responder resolved") end)
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
