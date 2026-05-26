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
const papilloperativeCode = "28150174";
const materialCode = "281501740";
const defenseTargetCode = "281501741";
const attackDecoyCode = "281501742";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPapilloperativeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${papilloperativeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasPapilloperativeScript)("Lua real script Photon Papilloperative detach position stat", () => {
  it("restores detach cost, Defense Position targeting, position change, and ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${papilloperativeCode}.lua`);
    expectPapilloperativeScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 28150174, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode], extra: [papilloperativeCode] }, 1: { main: [defenseTargetCode, attackDecoyCode] } });
    startDuel(session);

    const papilloperative = requireCard(session, papilloperativeCode);
    const material = requireCard(session, materialCode);
    const defenseTarget = requireCard(session, defenseTargetCode);
    const attackDecoy = requireCard(session, attackDecoyCode);
    moveFaceUpAttack(session, papilloperative, 0, 0);
    moveOverlayMaterial(session, papilloperative, material);
    moveMonster(session, defenseTarget, 1, "faceUpDefense", 0);
    moveMonster(session, attackDecoy, 1, "faceUpAttack", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(papilloperativeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === papilloperative.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], triggerEvent: undefined },
      { category: 0x201000, code: undefined, event: "ignition", property: 0x10, range: ["monsterZone"], triggerEvent: undefined },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === papilloperative.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(activation).not.toHaveProperty("operationInfos");
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toHaveLength(0);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === papilloperative.uid)?.overlayUids).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: papilloperative.uid,
      reasonEffectId: 2,
    });

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);

    expect(restoredResolved.session.state.cards.find((card) => card.uid === defenseTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      position: "faceUpAttack",
    });
    expect(restoredResolved.session.state.cards.find((card) => card.uid === attackDecoy.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      position: "faceUpAttack",
    });
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === defenseTarget.uid), restoredResolved.session.state)).toBe(1000);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === attackDecoy.uid), restoredResolved.session.state)).toBe(1700);
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === defenseTarget.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, reset: { flags: 33427456 }, value: -600 }]);
    expect(restoredResolved.session.state.eventHistory.filter((event) => ["detachedMaterial", "positionChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventPreviousState: event.eventPreviousState,
      eventCurrentState: event.eventCurrentState,
    }))).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: papilloperative.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: defenseTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: papilloperative.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: papilloperativeCode, name: "Photon Papilloperative", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 4, attack: 2100, defense: 1800 },
    { code: materialCode, name: "Photon Papilloperative Xyz Material", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: defenseTargetCode, name: "Photon Papilloperative Defense Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200 },
    { code: attackDecoyCode, name: "Photon Papilloperative Attack Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1700, defense: 1000 },
  ];
}

function expectPapilloperativeScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Xyz.AddProcedure(c,nil,4,2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_POSITION+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("Duel.IsExistingTarget(Card.IsDefensePos,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsDefensePos,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_POSITION,g,#g,0,0)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("Duel.ChangePosition(tc,POS_FACEUP_ATTACK)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-600)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  moveMonster(session, card, player, "faceUpAttack", sequence);
}

function moveMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId, position: "faceUpAttack" | "faceUpDefense", sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = position;
}

function moveOverlayMaterial(session: DuelSession, holder: DuelCardInstance, material: DuelCardInstance): void {
  moveDuelCard(session.state, material.uid, "overlay", holder.controller, duelReason.material | duelReason.xyz, holder.controller).sequence = holder.overlayUids.length;
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
