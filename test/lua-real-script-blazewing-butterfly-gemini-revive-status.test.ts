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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Blazewing Butterfly", () => {
  it("restores Gemini self-tribute revive and status grant", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const blazewingCode = "16984449";
    const geminiTargetCode = "3918345";
    const responderCode = "16984450";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [blazewingCode, geminiTargetCode].includes(card.code)),
      { code: responderCode, name: "Blazewing Butterfly Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1698, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [blazewingCode, geminiTargetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const blazewing = session.state.cards.find((card) => card.code === blazewingCode && card.location === "deck");
    const target = session.state.cards.find((card) => card.code === geminiTargetCode && card.location === "deck");
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(blazewing).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, blazewing!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "graveyard", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    blazewing!.faceUp = true;
    blazewing!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(blazewingCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredInitial.restoreComplete, restoredInitial.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredInitial, 0);
    expect(restoredInitial.missingRegistryKeys).toEqual([]);
    const geminiSummon = getLuaRestoreLegalActions(restoredInitial, 0).find((action) => action.type === "normalSummon" && action.uid === blazewing!.uid);
    expect(geminiSummon, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredInitial, geminiSummon!);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), source, reader);
    expect(restoredIgnition.restoreComplete, restoredIgnition.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredIgnition, 0);
    expect(restoredIgnition.missingRegistryKeys).toEqual([]);
    assertGeminiStatus(restoredIgnition, blazewingCode, true);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === blazewing!.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === blazewing!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.release | duelReason.cost,
    });
    expect(restoredIgnition.session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "released", eventCode: 1017, eventCardUid: blazewing!.uid })]),
    );
    expect(restoredIgnition.session.state.chain[0]).toMatchObject({
      sourceUid: blazewing!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x200, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredIgnition.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredChain, 1);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("blazewing butterfly responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(restoredChain.session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "specialSummoned", eventCode: 1102, eventCardUid: target!.uid })]),
    );
    assertGeminiStatus(restoredChain, geminiTargetCode, true);
    expect(restoredChain.session.state.flagEffects).toEqual(
      expect.arrayContaining([expect.objectContaining({ ownerType: "card", ownerId: target!.uid, code: 0, property: 0x4000000, value: 0 })]),
    );

    const restoredAfterStatus = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredAfterStatus.restoreComplete, restoredAfterStatus.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredAfterStatus, 0);
    expect(restoredAfterStatus.missingRegistryKeys).toEqual([]);
    assertGeminiStatus(restoredAfterStatus, geminiTargetCode, true);
    expect(restoredAfterStatus.host.messages).not.toContain("blazewing butterfly responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("blazewing butterfly responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function assertGeminiStatus(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: boolean): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${code}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("blazewing butterfly status " .. tostring(target and target:IsGeminiStatus()))
    `,
    `blazewing-butterfly-status-${code}-${expected ? "true" : "false"}.lua`,
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`blazewing butterfly status ${expected ? "true" : "false"}`);
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
