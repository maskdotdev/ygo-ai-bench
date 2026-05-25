import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { luaSummonTypeXyz } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const magiCode = "10000030";
const materialCode = "100000300";
const handCostCode = "100000301";
const opponentTargetCode = "100000302";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMagiScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${magiCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasMagiScript)("Lua real script Magi Magi detach banish control", () => {
  it("restores AND cost into detach, hand banish, SelectEffect, and temporary control", () => {
    const { workspace, reader, session } = createFixture(10000030);
    expectScriptShape(workspace.readScript(`official/c${magiCode}.lua`));
    const magi = requireCard(session, magiCode);
    const material = requireCard(session, materialCode);
    const handCost = requireCard(session, handCostCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    moveFaceUpAttack(session, magi, 0);
    magi.summonType = "xyz";
    magi.summonTypeCode = luaSummonTypeXyz;
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    magi.overlayUids.push(material.uid);
    moveDuelCard(session.state, handCost.uid, "hand", 0);
    moveFaceUpAttack(session, opponentTarget, 1);
    prepareMainPhase(session);
    registerMagi(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === magi.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", id: "lua-1-31", property: 0x40400, range: ["monsterZone"] },
      { category: undefined, code: undefined, countLimit: 1, event: "ignition", id: "lua-2", property: 0x10, range: ["monsterZone"] },
    ]);

    const control = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === magi.uid && action.effectId === "lua-2");
    expect(control, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, control!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === magi.uid)?.overlayUids).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: magi.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === handCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: magi.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: magi.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.host.promptDecisions.filter((prompt) => prompt.api === "SelectEffect")).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1], descriptions: [160000481], returned: 1 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["detachedMaterial", "banished", "becameTarget", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "detachedMaterial", eventCardUid: material.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: magi.uid, eventReasonEffectId: 2, previous: "overlay", current: "graveyard" },
      { eventName: "banished", eventCardUid: handCost.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: magi.uid, eventReasonEffectId: 2, previous: "hand", current: "banished" },
      { eventName: "becameTarget", eventCardUid: opponentTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "controlChanged", eventCardUid: opponentTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: magi.uid, eventReasonEffectId: 2, previous: "monsterZone", current: "monsterZone" },
    ]);
  });
});

function createFixture(seed: number): {
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  reader: ReturnType<typeof createCardReader>;
  session: DuelSession;
} {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialCode, handCostCode], extra: [magiCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: magiCode, name: "Magi Magi Magician Gal", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceSpellcaster, attribute: attributeDark, level: 6, attack: 2400, defense: 2000, xyzMaterialRace: raceSpellcaster, xyzMaterialCount: 2, xyzMaterialMax: 2 },
    { code: materialCode, name: "Magi Magi Xyz Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 6, attack: 1600, defense: 1200 },
    { code: handCostCode, name: "Magi Magi Hand Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: opponentTargetCode, name: "Magi Magi Opponent Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1400 },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("Magi Magi ☆ Magician Gal");
  expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_SPELLCASTER),6,2)");
  expect(script).toContain("e1:SetCost(Cost.AND(Cost.DetachFromSelf(1),s.effcost))");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsAbleToRemoveAsCost,tp,LOCATION_HAND,0,1,1,nil)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("local op=Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsControlerCanBeChanged,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsCanBeSpecialSummoned,tp,0,LOCATION_GRAVE,1,1,nil,e,0,tp,false,false)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerMagi(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(magiCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
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
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
