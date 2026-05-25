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
const jinzoLayeredCode = "99666430";
const materialCode = "996664300";
const releaseCode = "996664301";
const targetCode = "996664302";
const trapCode = "996664303";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasJinzoLayeredScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${jinzoLayeredCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const typeXyz = 0x800000;
const raceMachine = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const categoryControl = 0x2000;
const categoryDestroy = 0x1;
const categoryRelease = 0x2;
const effectFlagCardTarget = 0x10;
const effectCannotTrigger = 7;
const effectCannotAttack = 85;
const resetStandardPhaseEndControl = 1140724224;

describe.skipIf(!hasUpstreamScripts || !hasJinzoLayeredScript)("Lua real script Jinzo Layered detach control release destroy", () => {
  it("restores Xyz detach control locks and Trap-gated release destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${jinzoLayeredCode}.lua`));

    const control = createRestoredJinzoField(workspace);
    expect(control.session.state.effects.filter((effect) => effect.sourceUid === control.jinzo.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: control.jinzo.uid },
      { category: categoryControl, code: undefined, countLimit: 1, event: "ignition", property: effectFlagCardTarget, range: ["monsterZone"], sourceUid: control.jinzo.uid },
      { category: categoryRelease | categoryDestroy, code: undefined, countLimit: 1, event: "ignition", property: undefined, range: ["monsterZone"], sourceUid: control.jinzo.uid },
    ]);
    const controlAction = getLuaRestoreLegalActions(control.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === control.jinzo.uid && action.effectId === "lua-2"
    );
    expect(controlAction, JSON.stringify(getLuaRestoreLegalActions(control.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(control.restored, controlAction!);
    passRestoredChain(control.restored);

    expect(control.restored.session.state.cards.find((card) => card.uid === control.material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: control.jinzo.uid,
      reasonEffectId: 2,
    });
    expect(control.restored.session.state.cards.find((card) => card.uid === control.target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: control.jinzo.uid,
      reasonEffectId: 2,
    });
    expect(control.restored.session.state.effects.filter((effect) => effect.sourceUid === control.target.uid && [effectCannotTrigger, effectCannotAttack].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      description: effect.description,
      luaValueDescriptor: effect.luaValueDescriptor,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotTrigger, description: 3302, luaValueDescriptor: undefined, reset: { flags: resetStandardPhaseEndControl }, sourceUid: control.target.uid, value: 1 },
      { code: effectCannotAttack, description: 3206, luaValueDescriptor: undefined, reset: { flags: resetStandardPhaseEndControl }, sourceUid: control.target.uid, value: 1 },
    ]);
    expect(control.restored.session.state.eventHistory.filter((event) => ["detachedMaterial", "controlChanged"].includes(event.eventName)).map((event) => ({
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
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: control.material.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: control.jinzo.uid, eventReasonEffectId: 2, previousLocation: "overlay", previousController: 0, currentLocation: "graveyard", currentController: 0 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: control.target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: control.jinzo.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", previousController: 1, currentLocation: "monsterZone", currentController: 0 },
    ]);

    const destroy = createRestoredJinzoField(workspace);
    const destroyAction = getLuaRestoreLegalActions(destroy.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === destroy.jinzo.uid && action.effectId === "lua-3"
    );
    expect(destroyAction, JSON.stringify(getLuaRestoreLegalActions(destroy.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(destroy.restored, destroyAction!);
    passRestoredChain(destroy.restored);

    expect(destroy.restored.session.state.cards.find((card) => card.uid === destroy.jinzo.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: destroy.jinzo.uid,
      reasonEffectId: 3,
    });
    expect(destroy.restored.session.state.cards.find((card) => card.uid === destroy.release.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    expect(destroy.restored.session.state.cards.find((card) => card.uid === destroy.trap.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: destroy.jinzo.uid,
      reasonEffectId: 3,
    });
    expect(destroy.restored.session.state.eventHistory.filter((event) => ["released", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: destroy.jinzo.uid, eventReason: duelReason.release | duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: destroy.jinzo.uid, eventReasonEffectId: 3, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroy.trap.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: destroy.jinzo.uid, eventReasonEffectId: 3, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Jinzo - Layered");
  expect(script).toContain("Xyz.AddProcedure(c,nil,6,2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsControlerCanBeChanged),tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_TRIGGER)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("e2:SetCategory(CATEGORY_RELEASE+CATEGORY_DESTROY)");
  expect(script).toContain("Duel.CheckReleaseGroup(tp,s.tribfilter,1,nil)");
  expect(script).toContain("Duel.SelectReleaseGroup(tp,s.tribfilter,1,1,nil)");
  expect(script).toContain("Duel.Release(rg,REASON_EFFECT)");
  expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");
}

function createRestoredJinzoField(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  const reader = createCardReader(cards());
  const session = createDuel({ seed: 99666430, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialCode, releaseCode, trapCode], extra: [jinzoLayeredCode] }, 1: { main: [targetCode] } });
  startDuel(session);

  const jinzo = requireCard(session, jinzoLayeredCode);
  const material = requireCard(session, materialCode);
  const release = requireCard(session, releaseCode);
  const target = requireCard(session, targetCode);
  const trap = requireCard(session, trapCode);
  moveFaceUpAttack(session, jinzo, 0, 0);
  moveOverlayMaterial(session, jinzo, material, 0);
  moveFaceUpAttack(session, release, 0, 1);
  moveFaceUpAttack(session, target, 1, 0);
  const movedTrap = moveDuelCard(session.state, trap.uid, "spellTrapZone", 0);
  movedTrap.sequence = 0;
  movedTrap.faceUp = true;
  movedTrap.position = "faceUpAttack";
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(jinzoLayeredCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return { session, restored, jinzo, material, release, target, trap };
}

function cards(): DuelCardData[] {
  return [
    { code: jinzoLayeredCode, name: "Jinzo - Layered", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceMachine, attribute: attributeDark, level: 6, attack: 2400, defense: 1500 },
    { code: materialCode, name: "Jinzo Layered Overlay Material", kind: "monster", typeFlags: typeMonster, race: raceMachine, attribute: attributeDark, level: 6, attack: 1000, defense: 1000 },
    { code: releaseCode, name: "Jinzo Layered Release Candidate", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: targetCode, name: "Jinzo Layered Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    { code: trapCode, name: "Jinzo Layered Face-Up Trap", kind: "trap", typeFlags: typeTrap },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveOverlayMaterial(session: DuelSession, holder: DuelCardInstance, material: DuelCardInstance, sequence: number): void {
  const moved = moveDuelCard(session.state, material.uid, "overlay", holder.controller, duelReason.material | duelReason.xyz, holder.controller);
  moved.sequence = sequence;
  holder.overlayUids.push(material.uid);
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
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
