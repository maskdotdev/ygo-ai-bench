import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cardTypeFlags, currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const tuspaCode = "2089016";
const chronomalyCostCode = "20890160";
const targetCode = "20890161";
const numberXyzCode = "20890162";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTuspaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${tuspaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceMachine = 0x20;
const raceRock = 0x200000;
const attributeEarth = 0x1;
const attributeLight = 0x10;
const setNumber = 0x48;
const setChronomaly = 0x70;
const eventSummonSuccess = 1100;
const eventBeMaterial = 1108;
const effectUpdateAttack = 100;
const effectAddType = 115;
const effectExtraAttackMonster = 346;

describe.skipIf(!hasUpstreamScripts || !hasTuspaScript)("Lua real script Chronomaly Tuspa Rocket summon cost material grant", () => {
  it("restores summon cost label ATK drop and Xyz material grant", () => {
    const { workspace, reader, session } = createTuspaSession();
    const tuspa = requireCard(session, tuspaCode);
    const costMonster = requireCard(session, chronomalyCostCode);
    const target = requireCard(session, targetCode);
    const numberXyz = requireCard(session, numberXyzCode);
    moveDuelCard(session.state, tuspa.uid, "hand", 0);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tuspaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === tuspa.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: 0x200000, code: eventSummonSuccess, event: "trigger", id: "lua-1-1100", property: 0x10010, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { category: 0x200000, code: 1102, event: "trigger", id: "lua-2-1102", property: 0x10010, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { category: undefined, code: eventBeMaterial, event: "continuous", id: "lua-3-1108", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === tuspa.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, summon!);
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-1-1100", eventCardUid: tuspa.uid, eventCode: eventSummonSuccess, eventName: "normalSummoned", sourceUid: tuspa.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const statDrop = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === tuspa.uid);
    expect(statDrop, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, statDrop!);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === costMonster.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: tuspa.uid,
      reasonEffectId: 1,
    });
    resolveRestoredChain(restoredTrigger);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === tuspa.uid), restoredTrigger.session.state)).toBe(200);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === tuspa.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 1107169792 }, sourceUid: tuspa.uid, value: -800 },
    ]);

    const restoredXyzOpen = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredXyzOpen);
    expectRestoredLegalActions(restoredXyzOpen, 0);
    const xyzSummon = getLuaRestoreLegalActions(restoredXyzOpen, 0).find((action) =>
      action.type === "xyzSummon" && action.uid === numberXyz.uid && sameMembers(action.materialUids, [tuspa.uid])
    );
    expect(xyzSummon, JSON.stringify(getLuaRestoreLegalActions(restoredXyzOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredXyzOpen, xyzSummon!);
    expect(restoredXyzOpen.session.state.pendingTriggers).toEqual([]);
    expect(restoredXyzOpen.session.state.cards.find((card) => card.uid === numberXyz.uid)?.overlayUids).toEqual([tuspa.uid]);
    expect(restoredXyzOpen.session.state.eventHistory.filter((event) => event.eventName === "usedAsMaterial").map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
    }))).toContainEqual({
      current: "overlay",
      eventCardUid: tuspa.uid,
      eventCode: eventBeMaterial,
      eventReason: duelReason.xyz,
      eventReasonCardUid: numberXyz.uid,
      eventReasonPlayer: 0,
      previous: "monsterZone",
    });
    expect(cardTypeFlags(restoredXyzOpen.session.state.cards.find((card) => card.uid === numberXyz.uid)!, restoredXyzOpen.session.state) & typeEffect).toBe(typeEffect);
    expect(restoredXyzOpen.session.state.effects.filter((effect) => effect.sourceUid === numberXyz.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectExtraAttackMonster, event: "continuous", property: 0x4000000, reset: { flags: 0x1fe1000 }, sourceUid: numberXyz.uid, value: 1 },
      { code: effectAddType, event: "continuous", property: undefined, reset: { flags: 0x1fe1000 }, sourceUid: numberXyz.uid, value: typeEffect },
    ]);
    expect(restoredXyzOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createTuspaSession() {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${tuspaCode}.lua`));
  const reader = createCardReader(cards());
  const session = createDuel({ seed: 2089016, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [tuspaCode, chronomalyCostCode], extra: [numberXyzCode] },
    1: { main: [targetCode] },
  });
  startDuel(session);
  return { workspace, reader, session };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Chronomaly Tuspa Rocket");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkcostfilter,tp,LOCATION_DECK|LOCATION_EXTRA,0,1,1,nil):GetFirst()");
  expect(script).toContain("local lvrnk=tc:HasLevel() and tc:GetLevel() or tc:GetRank()");
  expect(script).toContain("e:SetLabel(lvrnk)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel()*-200)");
  expect(script).toContain("e3:SetCode(EVENT_BE_MATERIAL)");
  expect(script).toContain("return r==REASON_XYZ and c:IsPreviousLocation(LOCATION_ONFIELD) and c:GetReasonCard():IsSetCard(SET_NUMBER)");
  expect(script).toContain("e1:SetCode(EFFECT_EXTRA_ATTACK_MONSTER)");
  expect(script).toContain("e2:SetCode(EFFECT_ADD_TYPE)");
}

function cards(): DuelCardData[] {
  return [
    { code: tuspaCode, name: "Chronomaly Tuspa Rocket", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000, setcodes: [setChronomaly] },
    { code: chronomalyCostCode, name: "Chronomaly Cost Level 4", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeEarth, level: 4, attack: 800, defense: 800, setcodes: [setChronomaly] },
    { code: targetCode, name: "Tuspa Face-up Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 4, attack: 2000, defense: 1500 },
    { code: numberXyzCode, name: "Number Tuspa Xyz Receiver", kind: "extra", typeFlags: typeMonster | typeXyz, race: raceMachine, attribute: attributeLight, level: 4, attack: 2400, defense: 2000, setcodes: [setNumber], xyzMaterialCount: 1, xyzMaterialMax: 1 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function sameMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((uid) => actual.includes(uid));
}
