import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentLevel } from "#duel/card-stats.js";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Chemicritter Oxy Ox", () => {
  it("restores Gemini hand summon and final Level change", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const oxyOxCode = "18993198";
    const geminiTargetCode = "3918345";
    const responderCode = "18993199";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [oxyOxCode, geminiTargetCode].includes(card.code)),
      { code: responderCode, name: "Chemicritter Oxy Ox Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1899, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [oxyOxCode, geminiTargetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const oxyOx = session.state.cards.find((card) => card.code === oxyOxCode && card.location === "deck");
    const target = session.state.cards.find((card) => card.code === geminiTargetCode && card.location === "deck");
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(oxyOx).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, oxyOx!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    oxyOx!.faceUp = true;
    oxyOx!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    expect(oxyOx!.data.level).not.toBe(target!.data.level);

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(oxyOxCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredInitial.restoreComplete, restoredInitial.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredInitial, 0);
    expect(restoredInitial.missingRegistryKeys).toEqual([]);
    expect(restoredInitial.missingChainLimitRegistryKeys).toEqual([]);
    const geminiSummon = getLuaRestoreLegalActions(restoredInitial, 0).find((action) => action.type === "normalSummon" && action.uid === oxyOx!.uid);
    expect(geminiSummon, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredInitial, geminiSummon!);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), source, reader);
    expect(restoredIgnition.restoreComplete, restoredIgnition.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredIgnition, 0);
    expect(restoredIgnition.missingRegistryKeys).toEqual([]);
    expect(restoredIgnition.missingChainLimitRegistryKeys).toEqual([]);
    assertGeminiStatus(restoredIgnition, oxyOxCode, true);
    expect(currentLevel(restoredIgnition.session.state.cards.find((card) => card.uid === oxyOx!.uid), restoredIgnition.session.state)).toBe(oxyOx!.data.level);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === oxyOx!.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    expect(restoredIgnition.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "monsterZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-4",
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 512,
            "count": 1,
            "parameter": 2,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-18993198-0",
      }
    `);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredIgnition.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredChain, 1);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("chemicritter oxy ox responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: target!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: oxyOx!.uid,
        eventReasonEffectId: 4,
        eventUids: [target!.uid],
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
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
    expect(currentLevel(restoredChain.session.state.cards.find((card) => card.uid === oxyOx!.uid), restoredChain.session.state)).toBe(target!.data.level);
    expect(currentLevel(restoredChain.session.state.cards.find((card) => card.uid === target!.uid), restoredChain.session.state)).toBe(target!.data.level);
    expect(restoredChain.session.state.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: oxyOx!.uid, code: 314, value: target!.data.level })]),
    );

    const restoredAfterLevel = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredAfterLevel.restoreComplete, restoredAfterLevel.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredAfterLevel, 0);
    expect(restoredAfterLevel.missingRegistryKeys).toEqual([]);
    expect(restoredAfterLevel.missingChainLimitRegistryKeys).toEqual([]);
    expect(currentLevel(restoredAfterLevel.session.state.cards.find((card) => card.uid === oxyOx!.uid), restoredAfterLevel.session.state)).toBe(target!.data.level);
    assertLuaLevel(restoredAfterLevel, oxyOxCode, target!.data.level ?? 0);
    expect(restoredAfterLevel.host.messages).not.toContain("chemicritter oxy ox responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("chemicritter oxy ox responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function assertGeminiStatus(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: boolean): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${code}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("chemicritter oxy ox status " .. tostring(target and target:IsGeminiStatus()))
    `,
    `chemicritter-oxy-ox-status-${expected ? "true" : "false"}.lua`,
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`chemicritter oxy ox status ${expected ? "true" : "false"}`);
}

function assertLuaLevel(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: number): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${code}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("chemicritter oxy ox level " .. tostring(target and target:GetLevel()))
    `,
    `chemicritter-oxy-ox-level-${expected}.lua`,
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`chemicritter oxy ox level ${expected}`);
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
