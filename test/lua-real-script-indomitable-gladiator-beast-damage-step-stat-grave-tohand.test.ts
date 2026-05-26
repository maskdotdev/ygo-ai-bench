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
const indomitableCode = "55136228";
const fieldGladiatorCode = "551362280";
const graveGladiatorACode = "551362281";
const graveGladiatorBCode = "551362282";
const decoyCode = "551362283";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasIndomitableScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${indomitableCode}.lua`));
const setGladiatorBeast = 0x1019;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasIndomitableScript)("Lua real script Indomitable Gladiator Beast damage-step stat grave to-hand", () => {
  it("applies damage-step Gladiator Beast ATK gain and shuffles grave costs to recover itself", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${indomitableCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 55136228, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [indomitableCode, fieldGladiatorCode, graveGladiatorACode, graveGladiatorBCode, decoyCode] }, 1: { main: [] } });
    startDuel(session);

    const indomitable = requireCard(session, indomitableCode);
    const fieldGladiator = requireCard(session, fieldGladiatorCode);
    const graveGladiatorA = requireCard(session, graveGladiatorACode);
    const graveGladiatorB = requireCard(session, graveGladiatorBCode);
    const decoy = requireCard(session, decoyCode);
    moveDuelCard(session.state, indomitable.uid, "hand", 0);
    moveFaceUpMonster(session, fieldGladiator, 0, 0);
    moveDuelCard(session.state, graveGladiatorA.uid, "graveyard", 0);
    moveDuelCard(session.state, graveGladiatorB.uid, "graveyard", 0);
    moveFaceUpMonster(session, decoy, 0, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(indomitableCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredActivate = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredActivate);
    expectRestoredLegalActions(restoredActivate, 0);
    const activate = getLuaRestoreLegalActions(restoredActivate, 0).find((action) =>
      action.type === "activateEffect" && action.uid === indomitable.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredActivate, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivate, activate!);
    resolveRestoredChain(restoredActivate);

    expect(currentAttack(findCard(restoredActivate.session, fieldGladiator.uid), restoredActivate.session.state)).toBe(2300);
    expect(currentAttack(findCard(restoredActivate.session, decoy.uid), restoredActivate.session.state)).toBe(900);
    expect(findCard(restoredActivate.session, indomitable.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reasonPlayer: 0,
    });
    expect(findCard(restoredActivate.session, fieldGladiator.uid).attackModifier).toBe(500);
    expect(restoredActivate.session.state.eventHistory.filter((event) =>
      event.eventName === "becameTarget" || event.eventCardUid === fieldGladiator.uid
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: fieldGladiator.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredActivate.session), workspace, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) =>
      action.type === "activateEffect" && action.uid === indomitable.uid && action.effectId === "lua-2"
    );
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    resolveRestoredChain(restoredIgnition);

    for (const costCard of [graveGladiatorA, graveGladiatorB]) {
      expect(findCard(restoredIgnition.session, costCard.uid)).toMatchObject({
        location: "deck",
        controller: 0,
        reason: duelReason.cost,
        reasonPlayer: 0,
        reasonCardUid: indomitable.uid,
        reasonEffectId: 2,
      });
    }
    expect(findCard(restoredIgnition.session, indomitable.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: indomitable.uid,
      reasonEffectId: 2,
    });
    const graveReturnEvents = restoredIgnition.session.state.eventHistory.filter((event) =>
      ["sentToDeck", "sentToHand"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }));
    expect(graveReturnEvents).toContainEqual({ eventCardUid: graveGladiatorA.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.cost, eventReasonCardUid: indomitable.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 });
    expect(graveReturnEvents).toContainEqual({ eventCardUid: graveGladiatorB.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.cost, eventReasonCardUid: indomitable.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 });
    expect(graveReturnEvents).toContainEqual({ eventCardUid: indomitable.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: indomitable.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 });
    expect(restoredIgnition.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const indomitable = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === indomitableCode);
  expect(indomitable).toBeDefined();
  return [
    { ...indomitable!, kind: "spell", typeFlags: typeSpell },
    { code: fieldGladiatorCode, name: "Indomitable Gladiator Beast Field Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGladiatorBeast], level: 4, attack: 1800, defense: 1200 },
    { code: graveGladiatorACode, name: "Indomitable Gladiator Beast Grave Cost A", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGladiatorBeast], level: 4, attack: 1500, defense: 1200 },
    { code: graveGladiatorBCode, name: "Indomitable Gladiator Beast Grave Cost B", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGladiatorBeast], level: 4, attack: 1600, defense: 1000 },
    { code: decoyCode, name: "Indomitable Gladiator Beast Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 900 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsSetCard,SET_GLADIATOR_BEAST),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("tc:UpdateAttack(500,RESETS_STANDARD_PHASE_END,e:GetHandler())");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.rthcostfilter,tp,LOCATION_GRAVE,0,2,2,c)");
  expect(script).toContain("Duel.HintSelection(g)");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_COST)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,c,1,tp,0)");
  expect(script).toContain("Duel.SendtoHand(c,nil,REASON_EFFECT)");
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

function moveFaceUpMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
