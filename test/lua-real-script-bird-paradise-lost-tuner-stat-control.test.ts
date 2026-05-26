import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const birdCode = "84845628";
const tunerCostCode = "848456280";
const graveTunerOneCode = "848456281";
const graveTunerTwoCode = "848456282";
const opponentTargetCode = "848456283";
const opponentDecoyCode = "848456284";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBirdScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${birdCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const raceWyrm = 0x800000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const categoryControl = 0x2000;
const effectFlagSingleRange = 0x20000;
const effectFlagCardTarget = 0x10;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;
const reasonCost = duelReason.cost;

describe.skipIf(!hasUpstreamScripts || !hasBirdScript)("Lua real script Bird of Paradise Lost tuner stat control", () => {
  it("restores grave Tuner-count ATK/DEF and Tuner discard cost into temporary control", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${birdCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredBirdField({ reader, workspace });
    const bird = requireCard(restoredOpen.session, birdCode);
    const cost = requireCard(restoredOpen.session, tunerCostCode);
    const target = requireCard(restoredOpen.session, opponentTargetCode);
    const decoy = requireCard(restoredOpen.session, opponentDecoyCode);

    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(currentAttack(bird, restoredOpen.session.state)).toBe(2900);
    expect(currentDefense(bird, restoredOpen.session.state)).toBe(2100);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === bird.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: effectUpdateAttack, countLimit: undefined, event: "continuous", property: effectFlagSingleRange, range: ["monsterZone"], value: undefined },
      { category: undefined, code: effectUpdateDefense, countLimit: undefined, event: "continuous", property: effectFlagSingleRange, range: ["monsterZone"], value: undefined },
      { category: categoryControl, code: undefined, countLimit: 1, event: "ignition", property: effectFlagCardTarget, range: ["monsterZone"], value: undefined },
    ]);

    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === bird.uid
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);

    expect(findCard(restoredOpen.session, cost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      reason: reasonCost,
      reasonPlayer: 0,
      reasonCardUid: bird.uid,
      reasonEffectId: 3,
    });
    expect(findCard(restoredOpen.session, target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: bird.uid,
      reasonEffectId: 3,
    });
    expect(findCard(restoredOpen.session, decoy.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(currentAttack(findCard(restoredOpen.session, bird.uid), restoredOpen.session.state)).toBe(3000);
    expect(currentDefense(findCard(restoredOpen.session, bird.uid), restoredOpen.session.state)).toBe(2200);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCardUid: cost.uid, eventReason: reasonCost, eventReasonPlayer: 0, eventReasonCardUid: bird.uid, eventReasonEffectId: 3, previous: "hand", current: "graveyard", previousController: 0, currentController: 0 },
      { eventName: "becameTarget", eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "monsterZone", previousController: 1, currentController: 1 },
      { eventName: "controlChanged", eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: bird.uid, eventReasonEffectId: 3, previous: "monsterZone", current: "monsterZone", previousController: 1, currentController: 0 },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(currentAttack(findCard(restoredResolved.session, bird.uid), restoredResolved.session.state)).toBe(3000);
    expect(currentDefense(findCard(restoredResolved.session, bird.uid), restoredResolved.session.state)).toBe(2200);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: birdCode, name: "Bird of Paradise Lost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWyrm, attribute: attributeDark, level: 8, attack: 2700, defense: 1900 },
    { code: tunerCostCode, name: "Bird of Paradise Lost Tuner Cost", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceWarrior, attribute: attributeEarth, level: 3, attack: 1000, defense: 1000 },
    { code: graveTunerOneCode, name: "Bird of Paradise Lost Grave Tuner One", kind: "monster", typeFlags: typeMonster | typeTuner, race: raceWarrior, attribute: attributeEarth, level: 3, attack: 800, defense: 800 },
    { code: graveTunerTwoCode, name: "Bird of Paradise Lost Grave Tuner Two", kind: "monster", typeFlags: typeMonster | typeTuner, race: raceWarrior, attribute: attributeEarth, level: 3, attack: 900, defense: 900 },
    { code: opponentTargetCode, name: "Bird of Paradise Lost Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200 },
    { code: opponentDecoyCode, name: "Bird of Paradise Lost Opponent Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
  ];
}

function createRestoredBirdField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 84845628, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [birdCode, tunerCostCode, graveTunerOneCode, graveTunerTwoCode] },
    1: { main: [opponentTargetCode, opponentDecoyCode] },
  });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, birdCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, tunerCostCode).uid, "hand", 0);
  moveFaceUpGrave(session, requireCard(session, graveTunerOneCode), 0);
  moveFaceUpGrave(session, requireCard(session, graveTunerTwoCode), 0);
  moveFaceUpAttack(session, requireCard(session, opponentTargetCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentDecoyCode), 1, 1);
  session.state.turn = 2;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(birdCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Bird of Paradise Lost");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("Duel.GetMatchingGroupCount(Card.IsType,tp,LOCATION_GRAVE,0,nil,TYPE_TUNER)*100");
  expect(script).toContain("return c:IsType(TYPE_TUNER) and c:IsAbleToGraveAsCost()");
  expect(script).toContain("Duel.DiscardHand(tp,s.cfilter,1,1,REASON_COST,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsControlerCanBeChanged,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
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

function moveFaceUpGrave(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "graveyard", controller);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
