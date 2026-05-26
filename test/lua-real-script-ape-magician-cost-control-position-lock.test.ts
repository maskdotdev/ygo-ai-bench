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
const apeCode = "31975743";
const costCode = "319757430";
const defenseTargetCode = "319757431";
const attackNonTargetCode = "319757432";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasApeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${apeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceBeast = 0x4000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const categoryControl = 0x2000;
const effectFlagCannotDisable = 0x400;
const effectFlagUncopyable = 0x40000;
const effectFlagCardTarget = 0x10;
const effectFlagClientHint = 0x4000000;
const effectSpecialSummonCondition = 30;
const effectCannotChangePosition = 14;

describe.skipIf(!hasUpstreamScripts || !hasApeScript)("Lua real script Ape Magician cost control position lock", () => {
  it("restores special summon restriction, hand monster cost, defense control, and position-change lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${apeCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredApeField({ reader, workspace });
    const ape = requireCard(restoredOpen.session, apeCode);
    const cost = requireCard(restoredOpen.session, costCode);
    const target = requireCard(restoredOpen.session, defenseTargetCode);
    const attackNonTarget = requireCard(restoredOpen.session, attackNonTargetCode);

    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === ape.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      {
        category: undefined,
        code: effectSpecialSummonCondition,
        countLimit: undefined,
        event: "continuous",
        property: effectFlagCannotDisable | effectFlagUncopyable,
        range: ["monsterZone"],
      },
      { category: categoryControl, code: undefined, countLimit: 1, event: "ignition", property: effectFlagCardTarget, range: ["monsterZone"] },
    ]);

    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === ape.uid
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === cost.uid).map((event) => ({
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
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: cost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: ape.uid,
        eventReasonEffectId: 2,
        previousLocation: "hand",
        previousController: 0,
        currentLocation: "graveyard",
        currentController: 0,
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(findCard(restoredResolved.session, target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ape.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restoredResolved.session, attackNonTarget.uid)).toMatchObject({ controller: 1, location: "monsterZone", position: "faceUpAttack" });
    expect(restoredResolved.session.state.effects.filter((effect) =>
      effect.sourceUid === target.uid && effect.code === effectCannotChangePosition
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotChangePosition, event: "continuous", property: effectFlagClientHint, value: undefined },
    ]);
    expect(restoredResolved.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === target.uid)).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: target.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ape.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 1 },
      },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: apeCode, name: "Ape Magician", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 3, attack: 800, defense: 1200 },
    { code: costCode, name: "Ape Magician Cost Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: defenseTargetCode, name: "Ape Magician Defense Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1800 },
    { code: attackNonTargetCode, name: "Ape Magician Attack Non Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Ape Magician");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e2:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return e:GetHandler():IsAttackPos()");
  expect(script).toContain("return c:IsMonster() and c:IsAbleToGraveAsCost()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_HAND,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
  expect(script).toContain("return c:IsPosition(POS_FACEUP_DEFENSE) and c:IsControlerCanBeChanged()");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_CHANGE_POSITION)");
}

function createRestoredApeField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 31975743, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [apeCode, costCode] },
    1: { main: [defenseTargetCode, attackNonTargetCode] },
  });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, apeCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, costCode).uid, "hand", 0);
  moveFaceUpDefense(session, requireCard(session, defenseTargetCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, attackNonTargetCode), 1, 1);
  session.state.turn = 2;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(apeCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpDefense(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpDefense";
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
