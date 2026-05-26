import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { markProcedureComplete } from "#duel/procedure-status.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const sharkCode = "37279508";
const materialCode = "372795080";
const opponentACode = "372795081";
const opponentBCode = "372795082";
const reviveTargetCode = "372795083";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSharkScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sharkCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceSeaSerpent = 0x200;
const attributeWater = 0x2;
const attributeDark = 0x20;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasSharkScript)("Lua real script Number 37 Spider Shark attack drop destroyed revive", () => {
  it("restores attack-announcement detach ATK loss and destroyed-to-Grave monster revival", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${sharkCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const restoredAttack = createRestoredField({ reader, workspace });
    const shark = requireCard(restoredAttack.session, sharkCode);
    const material = requireCard(restoredAttack.session, materialCode);
    const opponentA = requireCard(restoredAttack.session, opponentACode, 1);
    const opponentB = requireCard(restoredAttack.session, opponentBCode, 1);
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);

    const attack = getLuaRestoreLegalActions(restoredAttack, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === shark.uid && action.targetUid === opponentA.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, attack!);

    const restoredDrop = restoreDuelWithLuaScripts(serializeDuel(restoredAttack.session), workspace, reader);
    expectCleanRestore(restoredDrop);
    expectRestoredLegalActions(restoredDrop, 0);
    const drop = getLuaRestoreLegalActions(restoredDrop, 0).find((action) => action.type === "activateTrigger" && action.uid === shark.uid);
    expect(drop, JSON.stringify(getLuaRestoreLegalActions(restoredDrop, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDrop, drop!);
    passRestoredChain(restoredDrop);

    expect(restoredDrop.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: shark.uid,
      reasonEffectId: 2,
    });
    expect(restoredDrop.session.state.cards.find((card) => card.uid === shark.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restoredDrop.session.state.cards.find((card) => card.uid === opponentA.uid), restoredDrop.session.state)).toBe(800);
    expect(currentAttack(restoredDrop.session.state.cards.find((card) => card.uid === opponentB.uid), restoredDrop.session.state)).toBe(700);
    expect(restoredDrop.session.state.effects.filter((effect) => [opponentA.uid, opponentB.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: opponentA.uid, value: -1000 },
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: opponentB.uid, value: -1000 },
    ]);

    const restoredDestroyed = createRestoredField({ reader, workspace });
    const destroyedShark = requireCard(restoredDestroyed.session, sharkCode);
    const reviveTarget = requireCard(restoredDestroyed.session, reviveTargetCode);
    moveDuelCard(restoredDestroyed.session.state, reviveTarget.uid, "graveyard", 0, duelReason.effect, 0);
    destroyDuelCard(restoredDestroyed.session.state, destroyedShark.uid, 0, duelReason.effect | duelReason.destroy, 0);
    restoredDestroyed.session.state.waitingFor = 0;

    const restoredRevive = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyed.session), workspace, reader);
    expectCleanRestore(restoredRevive);
    expectRestoredLegalActions(restoredRevive, 0);
    const revive = getLuaRestoreLegalActions(restoredRevive, 0).find((action) => action.type === "activateTrigger" && action.uid === destroyedShark.uid);
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredRevive, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRevive, revive!);
    passRestoredChain(restoredRevive);

    expect(restoredRevive.session.state.cards.find((card) => card.uid === reviveTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: destroyedShark.uid,
      reasonEffectId: 3,
    });
    expect(restoredRevive.session.state.eventHistory.filter((event) => ["attackDeclared", "detachedMaterial", "destroyed", "becameTarget", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyedShark.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: reviveTarget.uid, eventReason: duelReason.effect, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: reviveTarget.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: destroyedShark.uid, eventReasonEffectId: 3 },
    ]);
    expect(restoredRevive.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 37279508, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialCode, reviveTargetCode], extra: [sharkCode] }, 1: { main: [opponentACode, opponentBCode] } });
  startDuel(session);
  const shark = moveFaceUpAttack(session, requireCard(session, sharkCode), 0, 0);
  shark.summonType = "xyz";
  markProcedureComplete(shark);
  const material = moveDuelCard(session.state, requireCard(session, materialCode).uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
  material.sequence = 0;
  shark.overlayUids.push(material.uid);
  moveFaceUpAttack(session, requireCard(session, opponentACode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentBCode), 1, 1);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(sharkCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Number 37: Hope Woven Dragon Spider Shark");
  expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_WATER),4,2)");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-1000)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return c:IsReason(REASON_DESTROY) and c:IsReason(REASON_BATTLE|REASON_EFFECT)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,e:GetHandler(),e,tp)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: sharkCode, name: "Number 37: Hope Woven Dragon Spider Shark", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceSeaSerpent, attribute: attributeWater, level: 4, attack: 2600, defense: 2100, xyzMaterialCount: 2 },
    { code: materialCode, name: "Number 37 Xyz Material", kind: "monster", typeFlags: typeMonster, race: raceSeaSerpent, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
    { code: opponentACode, name: "Number 37 Opponent A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: opponentBCode, name: "Number 37 Opponent B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
    { code: reviveTargetCode, name: "Number 37 Graveyard Revive Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSeaSerpent, attribute: attributeWater, level: 4, attack: 1400, defense: 1200 },
  ];
}

function requireCard(session: DuelSession, code: string, controller?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.controller === controller));
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
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
