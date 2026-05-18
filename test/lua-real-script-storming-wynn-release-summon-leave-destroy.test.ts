import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasStormingWynnScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c29013526.lua"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeWind = 0x8;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasStormingWynnScript)("Lua real script Storming Wynn release-cost hand summon", () => {
  it("restores release cost, hand Special Summon, and owner leave-field destroy watcher", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const stormingWynnCode = "29013526";
    const releaseCostCode = "29013527";
    const summonTargetCode = "29013528";
    const offAttributeDecoyCode = "29013529";
    const blockerCodes = ["29013530", "29013531", "29013532"];
    const responderCode = "29013533";
    const stormingWynnScript = workspace.readScript(`c${stormingWynnCode}.lua`);
    expect(stormingWynnScript).toContain("Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,nil,e:GetHandler(),ft,tp)");
    expect(stormingWynnScript).toContain("Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,nil,e:GetHandler(),ft,tp)");
    expect(stormingWynnScript).toContain("Duel.Release(g,REASON_COST)");
    expect(stormingWynnScript).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_HAND,0,1,1,nil,e,tp)");
    expect(stormingWynnScript).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
    expect(stormingWynnScript).toContain("e1:SetCode(EVENT_LEAVE_FIELD)");
    expect(stormingWynnScript).toContain("if eg:IsExists(Card.IsCode,1,nil,id) then");
    expect(stormingWynnScript).toContain("Duel.Destroy(e:GetHandler(),REASON_EFFECT)");
    const cards: DuelCardData[] = [
      { code: stormingWynnCode, name: "Storming Wynn", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWind, level: 4, attack: 800, defense: 1500 },
      { code: releaseCostCode, name: "Storming Wynn WIND Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
      { code: summonTargetCode, name: "Storming Wynn WIND Summon Target", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWind, level: 4, attack: 1700, defense: 1000 },
      { code: offAttributeDecoyCode, name: "Storming Wynn EARTH Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
      ...blockerCodes.map((code, index) => ({ code, name: `Storming Wynn Zone Blocker ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 })),
      { code: responderCode, name: "Storming Wynn Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 29013526, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [stormingWynnCode, releaseCostCode, summonTargetCode, offAttributeDecoyCode, ...blockerCodes] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const stormingWynn = requireCard(session, stormingWynnCode);
    const releaseCost = requireCard(session, releaseCostCode);
    const summonTarget = requireCard(session, summonTargetCode);
    const offAttributeDecoy = requireCard(session, offAttributeDecoyCode);
    const blockers = blockerCodes.map((code) => requireCard(session, code));
    const responder = requireCard(session, responderCode);
    moveMonster(session, stormingWynn.uid, 0, 0);
    moveMonster(session, releaseCost.uid, 0, 1);
    blockers.forEach((blocker, index) => moveMonster(session, blocker.uid, 0, index + 2));
    moveDuelCard(session.state, summonTarget.uid, "hand", 0);
    moveDuelCard(session.state, offAttributeDecoy.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(stormingWynnCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === stormingWynn.uid);
    expect(activation, JSON.stringify(getDuelLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.cards.find((card) => card.uid === releaseCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: stormingWynn.uid,
    });
    expect(session.state.cards.find((card) => card.uid === offAttributeDecoy.uid)).toMatchObject({ location: "hand" });
    expect(session.state.chain[0]).toEqual({
      activationLocation: "monsterZone",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1",
      id: "chain-3",
      operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }],
      player: 0,
      sourceUid: stormingWynn.uid,
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("storming wynn responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === summonTarget.uid)).toMatchObject({
      controller: 0,
      location: "monsterZone",
      position: "faceUpAttack",
      faceUp: true,
      summonType: "special",
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === offAttributeDecoy.uid)).toMatchObject({ location: "hand" });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === releaseCost.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: releaseCost.uid,
        eventReason: duelReason.release | duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: stormingWynn.uid,
        eventReasonEffectId: 1,
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
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === summonTarget.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: summonTarget.uid,
        eventUids: [summonTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: stormingWynn.uid,
        eventReasonEffectId: 1,
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
    expect(
      restoredChain.session.state.effects.filter(
        (effect) => effect.event === "continuous" && effect.triggerEvent === "leftField" && effect.sourceUid === summonTarget.uid,
      ),
    ).toEqual([
      expect.objectContaining({
        code: 1015,
        controller: 0,
        registryKey: `lua:${stormingWynnCode}:lua-3-1015`,
        reset: { flags: 0x1fe1000 },
        sourceUid: summonTarget.uid,
        triggerCode: 1015,
        triggerEvent: "leftField",
      }),
    ]);

    const restoredWatcher = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredWatcher);
    expectRestoredLegalActions(restoredWatcher, 0);
    destroyDuelCard(restoredWatcher.session.state, blockers[0]!.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredWatcher.session.state.cards.find((card) => card.uid === summonTarget.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredWatcher.session.state.cards.find((card) => card.uid === blockers[0]!.uid)).toMatchObject({ location: "graveyard" });

    destroyDuelCard(restoredWatcher.session.state, stormingWynn.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredWatcher.session.state.cards.find((card) => card.uid === stormingWynn.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredWatcher.session.state.cards.find((card) => card.uid === summonTarget.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: summonTarget.uid,
    });
    expect(restoredWatcher.session.state.effects.find((effect) => effect.id === "lua-3-1015")).toBeUndefined();
    expect(restoredWatcher.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === summonTarget.uid)).toEqual([
      expect.objectContaining({
        eventCode: 1029,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonTarget.uid,
        eventReasonEffectId: 1,
      }),
    ]);
    expectRestoredLegalActions(restoredWatcher, 0);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveMonster(session: DuelSession, uid: string, player: 0 | 1, sequence: number): void {
  const moved = moveDuelCard(session.state, uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.position = "faceUpAttack";
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
      e:SetOperation(function(e,tp) Debug.Message("storming wynn responder resolved") end)
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
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
