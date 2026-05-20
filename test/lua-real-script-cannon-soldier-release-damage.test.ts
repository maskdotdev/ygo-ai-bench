import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const cannonSoldierCode = "11384280";
const releaseCode = "11384281";
const responderCode = "11384282";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cannon Soldier release damage", () => {
  it("restores single-monster release cost and fixed player-target damage after the released source leaves field", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cannonSoldierCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DAMAGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,nil,1,false,nil,nil)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,nil,1,1,false,nil,nil)");
    expect(script).toContain("Duel.Release(sg,REASON_COST)");
    expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
    expect(script).toContain("Duel.SetTargetParam(500)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cannonSoldierCode),
      { code: releaseCode, name: "Cannon Soldier Release Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Cannon Soldier Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 11384280, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cannonSoldierCode, releaseCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const cannonSoldier = requireCard(session, cannonSoldierCode);
    const release = requireCard(session, releaseCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, cannonSoldier.uid, 0);
    moveFaceUpAttack(session, release.uid, 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cannonSoldierCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === cannonSoldier.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredOpen, activation!);

    const releasedUids = releasedCostUids(restoredOpen.session);
    expect(releasedUids).toHaveLength(1);
    expect([cannonSoldier.uid, release.uid]).toContain(releasedUids[0]);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: cannonSoldier.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 500 }],
        targetParam: 500,
        targetPlayer: 1,
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredChain);

    expect(restoredChain.session.state.chain).toHaveLength(0);
    expect(restoredChain.host.messages).not.toContain("cannon soldier responder resolved");
    expect(restoredChain.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "released" && releasedUids.includes(event.eventCardUid ?? ""))).toContainEqual(
      releasedEvent(releasedUids[0]!, cannonSoldier.uid, releasedUids[0] === cannonSoldier.uid ? 0 : 1),
    );
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cannonSoldier.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, uid: string, player: 0 | 1): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function releasedCostUids(session: DuelSession): string[] {
  return session.state.eventHistory
    .filter((event) => event.eventName === "released" && event.eventReason === (duelReason.release | duelReason.cost) && !event.eventUids)
    .map((event) => event.eventCardUid!)
    .sort();
}

function releasedEvent(uid: string, sourceUid: string, sequence: number) {
  return {
    eventName: "released",
    eventCode: 1017,
    eventCardUid: uid,
    eventReason: duelReason.release | duelReason.cost,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence },
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
      e:SetOperation(function(e,tp) Debug.Message("cannon soldier responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAction(restored, pass!);
  }
}
