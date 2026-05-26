import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const borreloadCode = "27096833";
const opponentTargetCode = "270968330";
const ownDestroyCode = "270968331";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBorreloadScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${borreloadCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x10;
const categoryDestroy = 0x1;
const categorySpecialSummon = 0x200;
const categoryControl = 0x2000;
const effectFlagCardTarget = 0x10;
const effectFlagUncopyable = 0x40000;
const effectFlagCannotDisable = 0x400;

describe.skipIf(!hasUpstreamScripts || !hasBorreloadScript)("Lua real script Borreload Liberator linked control revive", () => {
  it("restores battle-phase linked-zone control and GY destroy-then-self-summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${borreloadCode}.lua`));
    const reader = createCardReader(cards());

    const control = createRestoredControlField({ reader, workspace });
    expect(control.restored.session.state.effects.filter((effect) => effect.sourceUid === control.borreload.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", property: effectFlagUncopyable | effectFlagCannotDisable, range: ["monsterZone"], sourceUid: control.borreload.uid, triggerEvent: undefined },
      { category: categoryControl, code: 1002, countLimit: 1, event: "quick", property: undefined, range: ["monsterZone"], sourceUid: control.borreload.uid, triggerEvent: undefined },
      { category: categoryDestroy | categorySpecialSummon, code: 1002, countLimit: 1, event: "quick", property: effectFlagCardTarget, range: ["graveyard"], sourceUid: control.borreload.uid, triggerEvent: undefined },
    ]);
    const controlAction = getLuaRestoreLegalActions(control.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === control.borreload.uid && action.effectId === "lua-2-1002"
    );
    expect(controlAction, JSON.stringify(getLuaRestoreLegalActions(control.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(control.restored, controlAction!);
    passRestoredChain(control.restored);

    expect(findCard(control.restored.session, control.opponentTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: control.borreload.uid,
      reasonEffectId: 2,
    });
    expect(control.restored.session.state.chainLimits).toEqual([]);
    expect(control.restored.session.state.eventHistory.filter((event) => ["controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      previousController: event.eventPreviousState?.controller,
      currentLocation: event.eventCurrentState?.location,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: control.opponentTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: control.borreload.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", previousController: 1, currentLocation: "monsterZone", currentController: 0 },
    ]);

    const revive = createRestoredReviveField({ reader, workspace });
    const reviveAction = getLuaRestoreLegalActions(revive.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === revive.borreload.uid && action.effectId === "lua-3-1002"
    );
    expect(reviveAction, JSON.stringify(getLuaRestoreLegalActions(revive.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(revive.restored, reviveAction!);
    passRestoredChain(revive.restored);

    expect(findCard(revive.restored.session, revive.ownDestroy.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: revive.borreload.uid,
      reasonEffectId: 3,
    });
    expect(findCard(revive.restored.session, revive.borreload.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: revive.borreload.uid,
      reasonEffectId: 3,
    });
    expect(revive.restored.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: revive.ownDestroy.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: revive.ownDestroy.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: revive.borreload.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: revive.borreload.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: revive.borreload.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: "graveyard", currentLocation: "monsterZone" },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Borreload Liberator Dragon");
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsType,TYPE_EFFECT),3)");
  expect(script).toContain("c:SetSPSummonOnce(id)");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetCondition(function() return Duel.IsBattlePhase() end)");
  expect(script).toContain("Duel.SetChainLimit(function(e,ep,tp) return tp==ep end)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.controlfilter,tp,0,LOCATION_MZONE,1,1,nil,zones)");
  expect(script).toContain("Duel.HintSelection(g)");
  expect(script).toContain("Duel.GetControl(g,tp,0,0,zones)");
  expect(script).toContain("e2:SetCountLimit(1,0,EFFECT_COUNT_CODE_CHAIN)");
  expect(script).toContain("Duel.SelectTarget(tp,s.desfilter,tp,LOCATION_MZONE,0,1,1,nil,tp)");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)>0");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
}

function createRestoredControlField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}) {
  const session = createDuel({ seed: 27096833, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [borreloadCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  const borreload = requireCard(session, borreloadCode);
  const opponentTarget = requireCard(session, opponentTargetCode);
  moveFaceUpAttack(session, borreload, 0, 5);
  moveFaceUpAttack(session, opponentTarget, 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const restored = registerAndRestore(session, workspace, reader);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return { restored, borreload, opponentTarget };
}

function createRestoredReviveField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}) {
  const session = createDuel({ seed: 27096834, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ownDestroyCode], extra: [borreloadCode] }, 1: { main: [] } });
  startDuel(session);
  const borreload = requireCard(session, borreloadCode);
  const ownDestroy = requireCard(session, ownDestroyCode);
  borreload.summonType = "link";
  borreload.summonTypeCode = 0x4c000000;
  borreload.customStatusMask = 0x8;
  moveDuelCard(session.state, borreload.uid, "graveyard", 0);
  borreload.faceUp = true;
  moveFaceUpAttack(session, ownDestroy, 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const restored = registerAndRestore(session, workspace, reader);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return { restored, borreload, ownDestroy };
}

function registerAndRestore(
  session: DuelSession,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
) {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(borreloadCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(): DuelCardData[] {
  return [
    { code: borreloadCode, name: "Borreload Liberator Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceDragon, attribute: attributeDark, level: 4, attack: 3000, defense: 0, linkMarkers: 0x7 },
    { code: opponentTargetCode, name: "Borreload Liberator Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    { code: ownDestroyCode, name: "Borreload Liberator Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  moveDuelCard(session.state, card.uid, "monsterZone", controller);
  card.sequence = sequence;
  card.position = "faceUpAttack";
  card.faceUp = true;
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0 && guard < 8) {
    guard += 1;
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
  expect(restored.session.state.chain).toEqual([]);
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}
