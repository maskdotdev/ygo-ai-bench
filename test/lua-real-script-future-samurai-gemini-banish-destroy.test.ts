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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Future Samurai", () => {
  it("restores Gemini banish cost and targeted face-up monster destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const samuraiCode = "90642597";
    const destroyTargetCode = "90642598";
    const costCode = "90642599";
    const responderCode = "90642600";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === samuraiCode),
      { code: destroyTargetCode, name: "Future Samurai Destroy Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: costCode, name: "Future Samurai Banish Cost", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Future Samurai Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9064, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [destroyTargetCode, samuraiCode, costCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const destroyTarget = session.state.cards.find((card) => card.code === destroyTargetCode);
    const samurai = session.state.cards.find((card) => card.code === samuraiCode);
    const cost = session.state.cards.find((card) => card.code === costCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(destroyTarget).toBeDefined();
    expect(samurai).toBeDefined();
    expect(cost).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, destroyTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, samurai!.uid, "monsterZone", 0);
    moveDuelCard(session.state, cost!.uid, "graveyard", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    destroyTarget!.faceUp = true;
    destroyTarget!.position = "faceUpAttack";
    samurai!.faceUp = true;
    samurai!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(samuraiCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredInitial.restoreComplete, restoredInitial.incompleteReasons.join("; ")).toBe(true);
    expect(restoredInitial.missingRegistryKeys).toEqual([]);
    expect(restoredInitial.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredInitial, 0);
    assertGeminiStatus(restoredInitial, samuraiCode, false);
    const geminiSummon = getLuaRestoreLegalActions(restoredInitial, 0).find((action) => action.type === "normalSummon" && action.uid === samurai!.uid);
    expect(geminiSummon, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredInitial, geminiSummon!);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), source, reader);
    expect(restoredIgnition.restoreComplete, restoredIgnition.incompleteReasons.join("; ")).toBe(true);
    expect(restoredIgnition.missingRegistryKeys).toEqual([]);
    expect(restoredIgnition.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredIgnition, 0);
    assertGeminiStatus(restoredIgnition, samuraiCode, true);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === samurai!.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === cost!.uid)).toMatchObject({
      location: "banished",
      previousLocation: "graveyard",
      reason: duelReason.cost,
    });
    expect(restoredIgnition.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === cost!.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: cost!.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: samurai!.uid,
        eventReasonEffectId: 4,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "banished",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restoredIgnition.session.state.chain[0]).toMatchObject({
      sourceUid: samurai!.uid,
      targetUids: [destroyTarget!.uid],
      operationInfos: [{ category: 0x1, targetUids: [destroyTarget!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredIgnition.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("future samurai responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === destroyTarget!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === samurai!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === destroyTarget!.uid)).toEqual([
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
        eventReasonCardUid: samurai!.uid,
        eventReasonEffectId: 4,
      },
    ]);

    const restoredAfterDestroy = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredAfterDestroy.restoreComplete, restoredAfterDestroy.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterDestroy.missingRegistryKeys).toEqual([]);
    expect(restoredAfterDestroy.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredAfterDestroy, 0);
    expect(restoredAfterDestroy.session.state.cards.find((card) => card.uid === cost!.uid)).toMatchObject({ location: "banished" });
    expect(restoredAfterDestroy.session.state.cards.find((card) => card.uid === destroyTarget!.uid)).toMatchObject({ location: "graveyard" });
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
      e:SetOperation(function(e,tp) Debug.Message("future samurai responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function assertGeminiStatus(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: boolean): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${code}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("future samurai status " .. tostring(target and target:IsGeminiStatus()))
    `,
    `future-samurai-status-${expected ? "true" : "false"}.lua`,
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`future samurai status ${expected ? "true" : "false"}`);
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
