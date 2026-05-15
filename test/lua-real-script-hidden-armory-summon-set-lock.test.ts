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
const typeEquip = 0x40000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Hidden Armory summon and set lock", () => {
  it("restores its Deck discard cost, Equip search, and Normal Summon/Set oath locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const hiddenArmoryCode = "52105192";
    const equipCode = "52105193";
    const costFodderCode = "52105194";
    const normalCandidateCode = "52105195";
    const responderCode = "52105196";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === hiddenArmoryCode),
      { code: equipCode, name: "Hidden Armory Equip Target", kind: "spell", typeFlags: typeSpell | typeEquip },
      { code: costFodderCode, name: "Hidden Armory Cost Fodder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: normalCandidateCode, name: "Hidden Armory Normal Candidate", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1200 },
      { code: responderCode, name: "Hidden Armory Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 521, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hiddenArmoryCode, costFodderCode, equipCode, normalCandidateCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const hiddenArmory = requireCard(session, hiddenArmoryCode);
    const equip = requireCard(session, equipCode);
    const normalCandidate = requireCard(session, normalCandidateCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, hiddenArmory.uid, "hand", 0);
    moveDuelCard(session.state, normalCandidate.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    expect(getLegalActions(session, 0).some((action) => action.type === "normalSummon" && action.uid === normalCandidate.uid)).toBe(true);
    expect(getLegalActions(session, 0).some((action) => action.type === "setMonster" && action.uid === normalCandidate.uid)).toBe(true);

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hiddenArmoryCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === hiddenArmory.uid);
    expect(activation).toBeDefined();
    applyAndAssert(session, activation!);
    const milledCard = session.state.cards.find((card) => card.location === "graveyard" && card.reason === duelReason.cost && card.reasonPlayer === 0);
    expect(milledCard).toBeDefined();
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: hiddenArmory.uid,
      operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x11 }],
    });
    expect(lockCodes(session, hiddenArmory.uid)).toEqual([20, 23]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 1);
    expect(lockCodes(restored.session, hiddenArmory.uid)).toEqual([20, 23]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.host.messages).not.toContain("hidden armory responder resolved");
    expect(restored.session.state.cards.find((card) => card.uid === equip.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === hiddenArmory.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "sentToGraveyard", eventCardUid: milledCard!.uid }),
        expect.objectContaining({ eventName: "sentToHand", eventCardUid: equip.uid }),
        expect.objectContaining({ eventName: "sentToHandConfirmed", eventPlayer: 1, eventUids: [equip.uid] }),
      ]),
    );

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredLock, 0);
    expect(lockCodes(restoredLock.session, hiddenArmory.uid)).toEqual([20, 23]);
    const actions = getLuaRestoreLegalActions(restoredLock, 0);
    expect(actions.some((action) => action.type === "normalSummon" && action.uid === normalCandidate.uid)).toBe(false);
    expect(actions.some((action) => action.type === "setMonster" && action.uid === normalCandidate.uid)).toBe(false);
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
      e:SetOperation(function(e,tp) Debug.Message("hidden armory responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function lockCodes(session: DuelSession, sourceUid: string): number[] {
  return session.state.effects
    .filter((effect) => effect.sourceUid === sourceUid && (effect.code === 20 || effect.code === 23))
    .map((effect) => effect.code!)
    .sort((a, b) => a - b);
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
