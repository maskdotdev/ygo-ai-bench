import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const afterglowCode = "62968263";
const drumCode = "77799846";
const materialCode = "629682630";
const photonDragonCode = "93717133";
const numberXyzCode = "629682631";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAfterglowScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${afterglowCode}.lua`));
const hasDrumScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${drumCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceDragon = 0x2000;
const raceMachine = 0x20;
const attributeLight = 0x10;
const attributeEarth = 0x1;
const setGalaxyEyes = 0x107b;
const setNumber = 0x48;
const effectSetAttackFinal = 102;
const eventToGrave = 1014;

describe.skipIf(!hasUpstreamScripts || !hasAfterglowScript || !hasDrumScript)("Lua real script Galaxy-Eyes Afterglow detach photon number stat", () => {
  it("restores detached Xyz-material trigger into Photon Dragon summon and Number Xyz attack doubling", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${afterglowCode}.lua`));
    const reader = createCardReader(cards());

    const restoredDetach = createRestoredField({ reader, workspace });
    expectCleanRestore(restoredDetach);
    expectRestoredLegalActions(restoredDetach, 0);
    const drum = requireCard(restoredDetach.session, drumCode);
    const afterglow = requireCard(restoredDetach.session, afterglowCode);
    const detach = getLuaRestoreLegalActions(restoredDetach, 0).find((action) => action.type === "activateEffect" && action.uid === drum.uid && action.effectId === "lua-5");
    expect(detach, JSON.stringify(getLuaRestoreLegalActions(restoredDetach, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDetach, detach!);
    resolveRestoredChain(restoredDetach);

    expect(restoredDetach.session.state.cards.find((card) => card.uid === afterglow.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: drum.uid,
      reasonEffectId: 5,
      previousLocation: "overlay",
    });
    expect(restoredDetach.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1014", eventCardUid: afterglow.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.cost, player: 0, sourceUid: afterglow.uid, triggerBucket: "turnOptional" },
    ]);
    restoredDetach.session.state.phase = "battle";
    restoredDetach.session.state.waitingFor = 0;

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDetach.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === afterglow.uid && action.effectId === "lua-2-1014");
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    const photon = requireCard(restoredTrigger.session, photonDragonCode);
    const numberXyz = requireCard(restoredTrigger.session, numberXyzCode);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === photon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: afterglow.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(numberXyz, restoredTrigger.session.state)).toBe(4800);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === numberXyz.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 33427456 }, sourceUid: numberXyz.uid, value: 4800 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["detachedMaterial", "specialSummoned", "breakEffect"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: afterglow.uid, eventUids: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: drum.uid, eventReasonEffectId: 5 },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: photon.uid, eventUids: [photon.uid], eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: afterglow.uid, eventReasonEffectId: 2 },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: afterglow.uid, eventReasonEffectId: 2 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Galaxy-Eyes Afterglow Dragon");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("e3:SetCode(EVENT_REMOVE)");
  expect(script).toContain("return c:IsReason(REASON_COST) and re:IsActivated() and re:IsActiveType(TYPE_XYZ) and c:IsPreviousLocation(LOCATION_OVERLAY)");
  expect(script).toContain("Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.Overlay(oc,tc)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(sc:GetAttack()*2)");
}

function cards(): DuelCardData[] {
  return [
    { code: afterglowCode, name: "Galaxy-Eyes Afterglow Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGalaxyEyes], race: raceDragon, attribute: attributeLight, level: 8, attack: 3000, defense: 2500 },
    { code: drumCode, name: "Googly-Eyes Drum Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceMachine, attribute: attributeEarth, level: 8, attack: 3000, defense: 2500 },
    { code: materialCode, name: "Afterglow Detach Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 8, attack: 1000, defense: 1000 },
    { code: photonDragonCode, name: "Galaxy-Eyes Photon Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 8, attack: 3000, defense: 2500 },
    { code: numberXyzCode, name: "Afterglow Number Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, setcodes: [setNumber], race: raceDragon, attribute: attributeLight, level: 8, attack: 2400, defense: 2000 },
  ];
}

function createRestoredField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 62968263, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [afterglowCode, materialCode, photonDragonCode], extra: [drumCode, numberXyzCode] }, 1: { main: [] } });
  startDuel(session);
  const drum = requireCard(session, drumCode);
  moveFaceUpAttack(session, drum, 0, 0);
  drum.summonType = "xyz";
  drum.customStatusMask = 0x8;
  attachOverlay(session, drum, requireCard(session, afterglowCode), 0);
  attachOverlay(session, drum, requireCard(session, materialCode), 1);
  const numberXyz = moveFaceUpAttack(session, requireCard(session, numberXyzCode), 0, 1);
  numberXyz.summonType = "xyz";
  numberXyz.customStatusMask = 0x8;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(afterglowCode), workspace).ok).toBe(true);
  expect(host.loadCardScript(Number(drumCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function attachOverlay(session: DuelSession, holder: DuelCardInstance, material: DuelCardInstance, sequence: number): void {
  const moved = moveDuelCard(session.state, material.uid, "overlay", holder.controller);
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
