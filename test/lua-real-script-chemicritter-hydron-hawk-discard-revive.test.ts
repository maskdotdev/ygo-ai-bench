import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Chemicritter Hydron Hawk", () => {
  it("restores Gemini discard cost and targeted Defense Position revive", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const hydronHawkCode = "55100740";
    const geminiTargetCode = "3918345";
    const discardCode = "55100741";
    const responderCode = "55100742";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [hydronHawkCode, geminiTargetCode].includes(card.code)),
      { code: discardCode, name: "Hydron Hawk Discard", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: responderCode, name: "Hydron Hawk Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5510, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hydronHawkCode, geminiTargetCode, discardCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const hydronHawk = session.state.cards.find((card) => card.code === hydronHawkCode && card.location === "deck");
    const target = session.state.cards.find((card) => card.code === geminiTargetCode && card.location === "deck");
    const discard = session.state.cards.find((card) => card.code === discardCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(hydronHawk).toBeDefined();
    expect(target).toBeDefined();
    expect(discard).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, hydronHawk!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "graveyard", 0);
    moveDuelCard(session.state, discard!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    hydronHawk!.faceUp = true;
    hydronHawk!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hydronHawkCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThanOrEqual(2);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredInitial.restoreComplete, restoredInitial.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restoredInitial, 0)).toEqual(getDuelLegalActions(restoredInitial.session, 0));
    const geminiSummon = getLuaRestoreLegalActions(restoredInitial, 0).find((action) => action.type === "normalSummon" && action.uid === hydronHawk!.uid);
    expect(geminiSummon, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredInitial, geminiSummon!);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), source, reader);
    expect(restoredIgnition.restoreComplete, restoredIgnition.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restoredIgnition, 0)).toEqual(getDuelLegalActions(restoredIgnition.session, 0));
    assertGeminiStatus(restoredIgnition, hydronHawkCode, true);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === hydronHawk!.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === discard!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "hand",
      reason: duelReason.cost | duelReason.discard,
    });
    expect(restoredIgnition.session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "discarded", eventCardUid: discard!.uid })]),
    );
    expect(restoredIgnition.session.state.chain[0]).toMatchObject({
      sourceUid: hydronHawk!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x200, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredIgnition.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("hydron hawk responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
    });
    expect(restoredChain.session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "specialSummoned", eventCode: 1102, eventCardUid: target!.uid })]),
    );

    const restoredAfterSummon = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredAfterSummon.restoreComplete, restoredAfterSummon.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterSummon.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ position: "faceUpDefense" });
    expect(restoredAfterSummon.host.messages).not.toContain("hydron hawk responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("hydron hawk responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function assertGeminiStatus(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: boolean): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${code}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("hydron hawk status " .. tostring(target and target:IsGeminiStatus()))
    `,
    `hydron-hawk-status-${expected ? "true" : "false"}.lua`,
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`hydron hawk status ${expected ? "true" : "false"}`);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
