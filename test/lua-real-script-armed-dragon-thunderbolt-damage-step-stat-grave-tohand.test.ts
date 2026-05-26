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
const thunderboltCode = "57605303";
const fieldDragonCode = "576053030";
const graveDragonACode = "576053031";
const graveDragonBCode = "576053032";
const graveDragonDuplicateCode = graveDragonACode;
const graveSpellCode = "576053033";
const decoyCode = "576053034";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasThunderboltScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${thunderboltCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeQuickPlay = 0x10000;
const setArmedDragon = 0x111;
const effectUpdateAttack = 100;
const effectNoBattleDamage = 200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasThunderboltScript)("Lua real script Armed Dragon Thunderbolt damage-step stat grave to-hand", () => {
  it("applies unique-name grave count ATK gain and grave SelfBanish recovery quick effect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${thunderboltCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const boost = createBoostScenario(workspace, reader);
    expectRestoredLegalActions(boost.restored, 0);
    const boostAction = getLuaRestoreLegalActions(boost.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === boost.thunderbolt.uid && action.effectId === "lua-1-1002"
    );
    expect(boostAction, JSON.stringify(getLuaRestoreLegalActions(boost.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(boost.restored, boostAction!);
    resolveRestoredChain(boost.restored);

    expect(currentAttack(findCard(boost.restored.session, boost.fieldDragon.uid), boost.restored.session.state)).toBe(4800);
    expect(currentAttack(findCard(boost.restored.session, boost.decoy.uid), boost.restored.session.state)).toBe(900);
    expect(boost.restored.session.state.effects.filter((effect) =>
      effect.sourceUid === boost.fieldDragon.uid && (effect.code === effectUpdateAttack || effect.code === effectNoBattleDamage)
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33427456 }, sourceUid: boost.fieldDragon.uid, value: 2000 },
      { code: effectNoBattleDamage, reset: { flags: 1107169792 }, sourceUid: boost.fieldDragon.uid, value: undefined },
    ]);
    expect(boost.restored.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: boost.fieldDragon.uid, eventCode: 1028, eventName: "becameTarget", eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);

    const recovery = createRecoveryScenario(workspace, reader);
    expectRestoredLegalActions(recovery.restored, 0);
    const recoveryAction = getLuaRestoreLegalActions(recovery.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === recovery.thunderbolt.uid && action.effectId === "lua-2-1002"
    );
    expect(recoveryAction, JSON.stringify(getLuaRestoreLegalActions(recovery.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(recovery.restored, recoveryAction!);
    resolveRestoredChain(recovery.restored);

    expect(findCard(recovery.restored.session, recovery.thunderbolt.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: recovery.thunderbolt.uid,
      reasonEffectId: 2,
    });
    expect(findCard(recovery.restored.session, recovery.graveSpell.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: recovery.thunderbolt.uid,
      reasonEffectId: 2,
    });
    expect(recovery.restored.session.state.eventHistory.filter((event) =>
      ["banished", "becameTarget", "sentToHand"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: recovery.thunderbolt.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: recovery.thunderbolt.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: recovery.graveSpell.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: recovery.graveSpell.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: recovery.thunderbolt.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
    ]);
    expect(recovery.restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createBoostScenario(
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
): { restored: ReturnType<typeof restoreDuelWithLuaScripts>; thunderbolt: DuelCardInstance; fieldDragon: DuelCardInstance; decoy: DuelCardInstance } {
  const session = createDuel({ seed: 57605303, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [thunderboltCode, fieldDragonCode, graveDragonACode, graveDragonBCode, graveDragonDuplicateCode, decoyCode] }, 1: { main: [] } });
  startDuel(session);
  const thunderbolt = requireCard(session, thunderboltCode);
  const fieldDragon = requireCard(session, fieldDragonCode);
  const graveDragonA = requireCard(session, graveDragonACode);
  const graveDragonB = requireCard(session, graveDragonBCode);
  const duplicateDragon = session.state.cards.find((card) => card.code === graveDragonDuplicateCode && card.uid !== graveDragonA.uid);
  expect(duplicateDragon).toBeDefined();
  const decoy = requireCard(session, decoyCode);
  moveDuelCard(session.state, thunderbolt.uid, "hand", 0);
  moveFaceUpMonster(session, fieldDragon, 0, 0);
  moveDuelCard(session.state, graveDragonA.uid, "graveyard", 0);
  moveDuelCard(session.state, graveDragonB.uid, "graveyard", 0);
  moveDuelCard(session.state, duplicateDragon!.uid, "graveyard", 0);
  moveFaceUpMonster(session, decoy, 0, 1);
  prepareOpenState(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(thunderboltCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restored);
  return { restored, thunderbolt, fieldDragon, decoy };
}

function createRecoveryScenario(
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
): { restored: ReturnType<typeof restoreDuelWithLuaScripts>; thunderbolt: DuelCardInstance; graveSpell: DuelCardInstance } {
  const session = createDuel({ seed: 57605304, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [thunderboltCode, graveSpellCode, decoyCode] }, 1: { main: [] } });
  startDuel(session);
  const thunderbolt = requireCard(session, thunderboltCode);
  const graveSpell = requireCard(session, graveSpellCode);
  moveDuelCard(session.state, thunderbolt.uid, "graveyard", 0);
  moveDuelCard(session.state, graveSpell.uid, "graveyard", 0);
  prepareOpenState(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(thunderboltCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restored);
  return { restored, thunderbolt, graveSpell };
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const thunderbolt = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === thunderboltCode);
  expect(thunderbolt).toBeDefined();
  return [
    { ...thunderbolt!, kind: "spell", typeFlags: typeSpell | typeQuickPlay, setcodes: [setArmedDragon] },
    { code: fieldDragonCode, name: "Armed Dragon Thunderbolt LV7 Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 7, attack: 2800, defense: 1000, setcodes: [setArmedDragon] },
    { code: graveDragonACode, name: "Armed Dragon Thunderbolt Grave LV3", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 1200, defense: 900, setcodes: [setArmedDragon] },
    { code: graveDragonBCode, name: "Armed Dragon Thunderbolt Grave LV5", kind: "monster", typeFlags: typeMonster | typeEffect, level: 5, attack: 2400, defense: 1700, setcodes: [setArmedDragon] },
    { code: graveSpellCode, name: "Armed Dragon Thunderbolt Grave Spell", kind: "spell", typeFlags: typeSpell, setcodes: [setArmedDragon] },
    { code: decoyCode, name: "Armed Dragon Thunderbolt Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 8, attack: 900, defense: 900 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.SelectTarget(tp,s.tgfilter,tp,LOCATION_MZONE,0,1,1,nil,tp)");
  expect(script).toContain("local val=g:GetClassCount(Card.GetCode)*1000");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(val)");
  expect(script).toContain("e2:SetCode(EFFECT_NO_BATTLE_DAMAGE)");
  expect(script).toContain("e2:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return c:IsSpell() and c:IsSetCard(SET_ARMED_DRAGON) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,g,1,0,0)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
}

function prepareOpenState(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
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
