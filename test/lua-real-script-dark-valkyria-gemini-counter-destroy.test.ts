import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
import { getDuelCardCounter } from "#duel/counters.js";
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
const counterSpell = 0x1;

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dark Valkyria", () => {
  it("restores Gemini Spell Counter placement, dynamic ATK, counter cost, and destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const valkyriaCode = "83269557";
    const destroyTargetCode = "83269558";
    const responderCode = "83269559";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === valkyriaCode),
      { code: destroyTargetCode, name: "Dark Valkyria Destroy Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Dark Valkyria Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8326, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [destroyTargetCode, valkyriaCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const destroyTarget = session.state.cards.find((card) => card.code === destroyTargetCode);
    const valkyria = session.state.cards.find((card) => card.code === valkyriaCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(destroyTarget).toBeDefined();
    expect(valkyria).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, destroyTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, valkyria!.uid, "monsterZone", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    destroyTarget!.faceUp = true;
    destroyTarget!.position = "faceUpAttack";
    valkyria!.faceUp = true;
    valkyria!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(valkyriaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredInitial.restoreComplete, restoredInitial.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredInitial, 0);
    expect(restoredInitial.missingRegistryKeys).toEqual([]);
    expect(restoredInitial.missingChainLimitRegistryKeys).toEqual([]);
    assertGeminiStatus(restoredInitial, valkyriaCode, false);
    const geminiSummon = getLuaRestoreLegalActions(restoredInitial, 0).find((action) => action.type === "normalSummon" && action.uid === valkyria!.uid);
    expect(geminiSummon, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredInitial, geminiSummon!);

    const restoredCounterIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), source, reader);
    expect(restoredCounterIgnition.restoreComplete, restoredCounterIgnition.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredCounterIgnition, 0);
    expect(restoredCounterIgnition.missingRegistryKeys).toEqual([]);
    expect(restoredCounterIgnition.missingChainLimitRegistryKeys).toEqual([]);
    assertGeminiStatus(restoredCounterIgnition, valkyriaCode, true);
    expect(currentAttack(restoredCounterIgnition.session.state.cards.find((card) => card.uid === valkyria!.uid), restoredCounterIgnition.session.state)).toBe(1800);
    const counterIgnition = getLuaRestoreLegalActions(restoredCounterIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === valkyria!.uid);
    expect(counterIgnition, JSON.stringify(getLuaRestoreLegalActions(restoredCounterIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounterIgnition, counterIgnition!);
    expect(restoredCounterIgnition.session.state.chain).toHaveLength(1);
    expect(restoredCounterIgnition.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "monsterZone",
        "activationSequence": 1,
        "chainIndex": 1,
        "effectId": "lua-6",
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 8388608,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-83269557-1",
      }
    `);

    const restoredCounterChain = restoreDuelWithLuaScripts(serializeDuel(restoredCounterIgnition.session), source, reader);
    expect(restoredCounterChain.restoreComplete, restoredCounterChain.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredCounterChain, 1);
    expect(restoredCounterChain.missingRegistryKeys).toEqual([]);
    expect(restoredCounterChain.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredCounterChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredCounterChain);
    const restoredValkyriaAfterCounter = restoredCounterChain.session.state.cards.find((card) => card.uid === valkyria!.uid);
    expect(getDuelCardCounter(restoredValkyriaAfterCounter, counterSpell)).toBe(1);
    expect(currentAttack(restoredValkyriaAfterCounter, restoredCounterChain.session.state)).toBe(2100);
    expect(restoredCounterChain.session.state.eventHistory.filter((event) => event.eventName === "counterAdded" && event.eventCardUid === valkyria!.uid)).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: valkyria!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: valkyria!.uid,
        eventReasonEffectId: 6,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
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
    expect(restoredCounterChain.host.messages).not.toContain("dark valkyria responder resolved");

    const restoredDestroyIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredCounterChain.session), source, reader);
    expect(restoredDestroyIgnition.restoreComplete, restoredDestroyIgnition.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredDestroyIgnition, 0);
    expect(restoredDestroyIgnition.missingRegistryKeys).toEqual([]);
    expect(restoredDestroyIgnition.missingChainLimitRegistryKeys).toEqual([]);
    expect(currentAttack(restoredDestroyIgnition.session.state.cards.find((card) => card.uid === valkyria!.uid), restoredDestroyIgnition.session.state)).toBe(2100);
    const destroyIgnition = getLuaRestoreLegalActions(restoredDestroyIgnition, 0)
      .filter((action) => action.type === "activateEffect" && action.uid === valkyria!.uid)
      .at(-1);
    expect(destroyIgnition, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyIgnition, destroyIgnition!);
    const valkyriaAfterCost = restoredDestroyIgnition.session.state.cards.find((card) => card.uid === valkyria!.uid);
    expect(getDuelCardCounter(valkyriaAfterCost, counterSpell)).toBe(0);
    expect(currentAttack(valkyriaAfterCost, restoredDestroyIgnition.session.state)).toBe(1800);
    expect(restoredDestroyIgnition.session.state.eventHistory.filter((event) => event.eventName === "counterRemoved" && event.eventCardUid === valkyria!.uid)).toEqual([
      {
        eventName: "counterRemoved",
        eventCode: 0x20000,
        eventCardUid: valkyria!.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: valkyria!.uid,
        eventReasonEffectId: 7,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
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
    expect(restoredDestroyIgnition.session.state.chain).toHaveLength(1);
    expect(restoredDestroyIgnition.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "monsterZone",
        "activationSequence": 1,
        "chainIndex": 1,
        "effectId": "lua-7",
        "id": "chain-6",
        "operationInfos": [
          {
            "category": 1,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-83269558-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-83269557-1",
        "targetFieldIds": [
          4,
        ],
        "targetUids": [
          "p0-deck-83269558-0",
        ],
      }
    `);

    const restoredDestroyChain = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyIgnition.session), source, reader);
    expect(restoredDestroyChain.restoreComplete, restoredDestroyChain.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredDestroyChain, 1);
    expect(restoredDestroyChain.missingRegistryKeys).toEqual([]);
    expect(restoredDestroyChain.missingChainLimitRegistryKeys).toEqual([]);
    resolveRestoredChain(restoredDestroyChain);
    expect(restoredDestroyChain.session.state.cards.find((card) => card.uid === destroyTarget!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(restoredDestroyChain.session.state.cards.find((card) => card.uid === valkyria!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredDestroyChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === destroyTarget!.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyTarget!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: valkyria!.uid,
        eventReasonEffectId: 7,
      },
    ]);

    const restoredAfterDestroy = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyChain.session), source, reader);
    expect(restoredAfterDestroy.restoreComplete, restoredAfterDestroy.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredAfterDestroy, 0);
    expect(restoredAfterDestroy.missingRegistryKeys).toEqual([]);
    expect(restoredAfterDestroy.missingChainLimitRegistryKeys).toEqual([]);
    expect(getDuelCardCounter(restoredAfterDestroy.session.state.cards.find((card) => card.uid === valkyria!.uid), counterSpell)).toBe(0);
    expect(restoredAfterDestroy.session.state.cards.find((card) => card.uid === destroyTarget!.uid)).toMatchObject({ location: "graveyard" });
  }, 20_000);
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
      e:SetOperation(function(e,tp) Debug.Message("dark valkyria responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function assertGeminiStatus(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: boolean): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${code}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("dark valkyria status " .. tostring(target and target:IsGeminiStatus()))
    `,
    `dark-valkyria-status-${expected ? "true" : "false"}.lua`,
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`dark valkyria status ${expected ? "true" : "false"}`);
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
