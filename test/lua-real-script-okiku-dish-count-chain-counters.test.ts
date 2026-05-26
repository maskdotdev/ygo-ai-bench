import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDuelCardCounter } from "#duel/counters.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const okikuCode = "89086647";
const chainStarterCode = "890866470";
const deckCardCodes = Array.from({ length: 10 }, (_, index) => `89086648${index}`);
const counterDish = 0x216;
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Okiku Dish Count chain counters", () => {
  it("restores opponent EVENT_CHAINING response into Dish Counters and static protection thresholds", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${okikuCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 89086647, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [okikuCode, ...deckCardCodes] }, 1: { main: [chainStarterCode] } });
    startDuel(session);

    const okiku = requireCard(session, okikuCode);
    const chainStarter = requireCard(session, chainStarterCode);
    moveFaceUpSpell(session, okiku, 0);
    moveDuelCard(session.state, chainStarter.uid, "hand", 1);
    for (const code of deckCardCodes) moveDuelCard(session.state, requireCard(session, code).uid, "deck", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = fixtureSource(workspace);
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(okikuCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(chainStarterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.filter((effect) => effect.sourceUid === okiku.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { code: 0x10000 + counterDish, event: "continuous", range: ["spellTrapZone"], value: 264 },
      { code: 1002, event: "quick", range: ["spellTrapZone"], value: undefined },
      { code: 1027, event: "quick", range: ["spellTrapZone"], value: undefined },
      { code: 71, event: "continuous", range: ["spellTrapZone"], value: undefined },
      { code: 41, event: "continuous", range: ["spellTrapZone"], value: undefined },
      { code: 142, event: "continuous", range: ["spellTrapZone"], value: undefined },
      { code: 1014, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], value: undefined },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const starter = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === chainStarter.uid);
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, starter!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-8-1002",
        sourceUid: chainStarter.uid,
        player: 1,
        activationLocation: "hand",
        activationSequence: 0,
      },
    ]);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const okikuResponse = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === okiku.uid);
    expect(okikuResponse, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    expect(okikuResponse).toMatchObject({ windowKind: "chainResponse" });
    applyRestoredActionAndAssert(restoredResponse, okikuResponse!);

    expect(restoredResponse.session.state.chain).toEqual([]);
    expect(restoredResponse.session.state.cards.find((card) => card.uid === chainStarter.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 1,
    });
    expect(getDuelCardCounter(restoredResponse.session.state.cards.find((card) => card.uid === okiku.uid), counterDish)).toBe(2);
    expect(restoredResponse.session.state.eventHistory.filter((event) => event.eventName === "counterAdded" && event.eventCardUid === okiku.uid)).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: okiku.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 9 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: okiku.uid,
        eventReasonEffectId: 3,
      },
    ]);

    const restoredAfterCounter = restoreDuelWithLuaScripts(serializeDuel(restoredResponse.session), source, reader);
    expectCleanRestore(restoredAfterCounter);
    expectRestoredLegalActions(restoredAfterCounter, 0);
    expect(getDuelCardCounter(restoredAfterCounter.session.state.cards.find((card) => card.uid === okiku.uid), counterDish)).toBe(2);
    expect(restoredAfterCounter.session.state.effects.filter((effect) => effect.sourceUid === okiku.uid && [71, 41, 142].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      condition: effect.luaConditionDescriptor,
      valueDescriptor: effect.luaValueDescriptor,
    }))).toEqual([
      { code: 71, condition: undefined, valueDescriptor: "cannot-be-effect-target:opponent" },
      { code: 41, condition: undefined, valueDescriptor: "indestructible:opponent" },
      { code: 142, condition: undefined, valueDescriptor: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === okikuCode),
    { code: chainStarterCode, name: "Okiku Chain Starter", kind: "spell", typeFlags: typeSpell },
    ...deckCardCodes.map((code, index): DuelCardData => ({
      code,
      name: `Okiku Deck Card ${index + 1}`,
      kind: "spell",
      typeFlags: typeSpell,
    })),
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${chainStarterCode}.lua`) return chainStarterScript();
      return workspace.readScript(name);
    },
  };
}

function chainStarterScript(): string {
  return `
local s,id=GetID()
function s.initial_effect(c)
  local e=Effect.CreateEffect(c)
  e:SetType(EFFECT_TYPE_ACTIVATE)
  e:SetCode(EVENT_FREE_CHAIN)
  e:SetOperation(function(e,tp) Debug.Message("okiku starter resolved") end)
  c:RegisterEffect(e)
end
`;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("Okiku's Dish Count");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_DISH)");
  expect(script).toContain("e0:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
  expect(script).toContain("e1:SetCountLimit(1,0,EFFECT_COUNT_CODE_CHAIN)");
  expect(script).toContain("return rp==1-tp");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,e:GetHandler(),Duel.GetCurrentChain(),tp,COUNTER_DISH)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_DISH,Duel.GetCurrentChain())");
  expect(script).toContain("e2a:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
  expect(script).toContain("e2a:SetValue(aux.tgoval)");
  expect(script).toContain("e2b:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("e2b:SetValue(aux.indoval)");
  expect(script).toContain("e2c:SetCode(EFFECT_SELF_TOGRAVE)");
  expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("Duel.IsPlayerCanDiscardDeck(tp,10)");
  expect(script).toContain("Duel.DiscardDeck(tp,10,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  return moved;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
