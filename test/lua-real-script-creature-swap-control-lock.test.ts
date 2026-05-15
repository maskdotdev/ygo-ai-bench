import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Creature Swap control lock", () => {
  it("restores Creature Swap's non-targeting control exchange and position locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const creatureSwapCode = "31036355";
    const ownCode = "612401";
    const opponentCode = "612402";
    const responderCode = "612403";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === creatureSwapCode),
      { code: ownCode, name: "Creature Swap Owned Monster", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000 },
      { code: opponentCode, name: "Creature Swap Opponent Monster", kind: "monster", typeFlags: 0x21, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Creature Swap Chain Responder", kind: "monster", typeFlags: 0x21, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 306, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [creatureSwapCode, ownCode] }, 1: { main: [opponentCode, responderCode] } });
    startDuel(session);

    const creatureSwap = session.state.cards.find((card) => card.code === creatureSwapCode);
    const ownMonster = session.state.cards.find((card) => card.code === ownCode);
    const opponentMonster = session.state.cards.find((card) => card.code === opponentCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(creatureSwap).toBeDefined();
    expect(ownMonster).toBeDefined();
    expect(opponentMonster).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, creatureSwap!.uid, "hand", 0);
    moveDuelCard(session.state, ownMonster!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, opponentMonster!.uid, "monsterZone", 1).position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(creatureSwapCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === creatureSwap!.uid);
    expect(activation).toBeDefined();
    applyAndAssert(session, activation!);

    const openedSnapshot = serializeDuel(session);
    expect(openedSnapshot.state.chain[0]).toMatchObject({
      sourceUid: creatureSwap!.uid,
      operationInfos: [{ category: 0x2000, targetUids: [], count: 0, player: 0, parameter: 0 }],
    });
    expect(openedSnapshot.state.chain[0]?.targetUids ?? []).toEqual([]);

    const restoredResponseWindow = restoreDuelWithLuaScripts(openedSnapshot, source, reader);
    expect(restoredResponseWindow.restoreComplete, restoredResponseWindow.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredResponseWindow, 1);
    expect(restoredResponseWindow.missingRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const pass = getLuaRestoreLegalActions(restoredResponseWindow, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredResponseWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restoredResponseWindow.host.messages).not.toContain("creature swap responder resolved");
    expect(restoredResponseWindow.session.state.cards.find((card) => card.uid === ownMonster!.uid)).toMatchObject({
      controller: 1,
      previousController: 0,
      location: "monsterZone",
    });
    expect(restoredResponseWindow.session.state.cards.find((card) => card.uid === opponentMonster!.uid)).toMatchObject({
      controller: 0,
      previousController: 1,
      location: "monsterZone",
    });
    expect(restoredResponseWindow.session.state.cards.find((card) => card.uid === creatureSwap!.uid)).toMatchObject({ location: "graveyard" });
    expect(positionLockCodes(restoredResponseWindow.session, ownMonster!.uid)).toEqual([14]);
    expect(positionLockCodes(restoredResponseWindow.session, opponentMonster!.uid)).toEqual([14]);

    const restoredLockWindow = restoreDuelWithLuaScripts(serializeDuel(restoredResponseWindow.session), source, reader);
    expect(restoredLockWindow.restoreComplete, restoredLockWindow.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredLockWindow, 0);
    expect(restoredLockWindow.missingRegistryKeys).toEqual([]);
    expect(restoredLockWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredLockWindow.session.state.cards.find((card) => card.uid === ownMonster!.uid)).toMatchObject({ controller: 1, previousController: 0 });
    expect(restoredLockWindow.session.state.cards.find((card) => card.uid === opponentMonster!.uid)).toMatchObject({ controller: 0, previousController: 1 });
    expect(positionLockCodes(restoredLockWindow.session, ownMonster!.uid)).toEqual([14]);
    expect(positionLockCodes(restoredLockWindow.session, opponentMonster!.uid)).toEqual([14]);

    const probe = restoredLockWindow.host.loadScript(positionProbeScript(ownCode, opponentCode), "creature-swap-position-probe.lua");
    expect(probe.ok, probe.error).toBe(true);
    expect(restoredLockWindow.host.messages).toContain("creature swap position probe false/false");
    expect(getLuaRestoreLegalActions(restoredLockWindow, 0).some((action) => action.type === "changePosition" && action.uid === opponentMonster!.uid)).toBe(false);

    const endTurn = getLuaRestoreLegalActions(restoredLockWindow, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const nextTurn = applyLuaRestoreResponse(restoredLockWindow, endTurn!);
    expect(nextTurn.ok, nextTurn.error).toBe(true);
    expect(restoredLockWindow.session.state.cards.find((card) => card.uid === ownMonster!.uid)).toMatchObject({ controller: 1, previousController: 0 });
    expect(restoredLockWindow.session.state.cards.find((card) => card.uid === opponentMonster!.uid)).toMatchObject({ controller: 0, previousController: 1 });
    expect(positionLockCodes(restoredLockWindow.session, ownMonster!.uid)).toEqual([]);
    expect(positionLockCodes(restoredLockWindow.session, opponentMonster!.uid)).toEqual([]);
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
      e:SetOperation(function(e,tp) Debug.Message("creature swap responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function positionProbeScript(ownCode: string, opponentCode: string): string {
  return `
    local own=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${ownCode}),1,LOCATION_MZONE,0,1,1,nil):GetFirst()
    local opp=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${opponentCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
    Debug.Message("creature swap position probe " .. tostring(own and own:IsCanChangePosition()) .. "/" .. tostring(opp and opp:IsCanChangePosition()))
  `;
}

function positionLockCodes(session: DuelSession, uid: string): number[] {
  return session.state.effects
    .filter((effect) => effect.sourceUid === uid && effect.code === 14)
    .map((effect) => effect.code!)
    .sort((a, b) => a - b);
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
