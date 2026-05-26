import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const endymionCode = "3611830";
const destroyTargetCode = "36118300";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasEndymionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${endymionCode}.lua`));
const spellCounter = 0x1;
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasEndymionScript)("Lua real script Endymion counter PZONE summon", () => {
  it("restores Spell Counter field cost into PZONE Special Summon and destroy selection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${endymionCode}.lua`);
    expectScriptShape(script);

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === endymionCode),
      { code: destroyTargetCode, name: "Endymion Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3611830, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [endymionCode] }, 1: { main: [destroyTargetCode] } });
    startDuel(session);

    const endymion = requireCard(session, endymionCode);
    const destroyTarget = requireCard(session, destroyTargetCode);
    movePzone(session, endymion, 0, 0);
    moveFaceUpAttack(session, destroyTarget, 1);
    expect(addDuelCardCounter(endymion, spellCounter, 6)).toBe(true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(endymionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === endymion.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: 0x10000 + spellCounter, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined, value: 4 },
      { category: undefined, code: 320, event: "continuous", range: ["spellTrapZone"], triggerEvent: undefined, value: 1241513984 },
      { category: undefined, code: 1002, event: "ignition", range: ["hand"], triggerEvent: undefined, value: undefined },
      { category: 8389121, code: undefined, event: "ignition", range: ["spellTrapZone"], triggerEvent: undefined, value: undefined },
      { category: 276824073, code: 1027, event: "quick", range: ["monsterZone"], triggerEvent: "chaining", value: undefined },
      { category: undefined, code: 71, event: "continuous", range: ["monsterZone"], triggerEvent: undefined, value: undefined },
      { category: undefined, code: 41, event: "continuous", range: ["monsterZone"], triggerEvent: undefined, value: undefined },
      { category: undefined, code: 1019, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "leftField", value: undefined },
      { category: 131080, code: 1140, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "battleDestroyed", value: undefined },
      { category: undefined, code: 3682106, event: "continuous", range: ["monsterZone"], triggerEvent: undefined, value: undefined },
    ]);

    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === endymion.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, action!);
    resolveRestoredChain(restoredOpen);

    const restoredEndymion = restoredOpen.session.state.cards.find((card) => card.uid === endymion.uid);
    const restoredTarget = restoredOpen.session.state.cards.find((card) => card.uid === destroyTarget.uid);
    expect(restoredEndymion).toMatchObject({
      location: "extraDeck",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: endymion.uid,
      reasonEffectId: 4,
    });
    expect(restoredTarget).toMatchObject({
      location: "monsterZone",
      controller: 1,
    });
    expect(getDuelCardCounter(restoredEndymion, spellCounter)).toBe(0);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["counterRemoved", "specialSummoned", "breakEffect", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "counterRemoved",
        eventCode: 0x20000,
        eventCardUid: endymion.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: endymion.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: endymion.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: endymion.uid,
        eventReasonEffectId: 4,
        eventUids: [endymion.uid],
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: endymion.uid,
        eventReasonEffectId: 4,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: endymion.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: endymion.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Endymion, the Mighty Master of Magic");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
  expect(script).toContain("Duel.IsCanRemoveCounter(tp,1,0,COUNTER_SPELL,6,REASON_COST)");
  expect(script).toContain("Duel.RemoveCounter(tp,1,0,COUNTER_SPELL,6,REASON_COST)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsCanAddCounter,COUNTER_SPELL,1,false,LOCATION_ONFIELD),tp,LOCATION_ONFIELD,0,nil)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.TRUE,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,dc,nil)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
  expect(script).toContain("c:AddCounter(COUNTER_SPELL,oc)");
  expect(script).toContain("Duel.IsChainNegatable(ev)");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("e3:SetValue(aux.tgoval)");
  expect(script).toContain("aux.DoubleSnareValidity(c,LOCATION_MZONE)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function movePzone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
