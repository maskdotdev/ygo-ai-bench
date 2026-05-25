import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel, createDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const staffCode = "21438286";
const equippedCode = "214382860";
const opponentACode = "214382861";
const opponentBCode = "214382862";
const opponentFaceDownCode = "214382863";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasStaffScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${staffCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEquip = 0x40000;
const typeEffect = 0x20;
const raceFiend = 0x8;
const attributeDark = 0x20;
const eventLeaveField = 1015;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasStaffScript)("Lua real script Archfiend's Staff of Despair equip drop leave to-hand", () => {
  it("restores equipped monster half-ATK opponent drop and leave-field LP-cost self return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${staffCode}.lua`));
    const reader = createCardReader(cards(workspace));

    const restoredDrop = createRestoredEquippedOpen(reader, workspace, 21438286);
    expectCleanRestore(restoredDrop);
    expectRestoredLegalActions(restoredDrop, 0);
    const staff = requireCard(restoredDrop.session, staffCode);
    const equipped = requireCard(restoredDrop.session, equippedCode);
    const opponentA = requireCard(restoredDrop.session, opponentACode);
    const opponentB = requireCard(restoredDrop.session, opponentBCode);
    const opponentFaceDown = requireCard(restoredDrop.session, opponentFaceDownCode);
    const drop = getLuaRestoreLegalActions(restoredDrop, 0).find((action) => action.type === "activateEffect" && action.uid === staff.uid && action.effectId === "lua-3");
    expect(drop, JSON.stringify(getLuaRestoreLegalActions(restoredDrop, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDrop, drop!);
    resolveRestoredChain(restoredDrop);
    expect(currentAttack(restoredDrop.session.state.cards.find((card) => card.uid === opponentA.uid), restoredDrop.session.state)).toBe(600);
    expect(currentAttack(restoredDrop.session.state.cards.find((card) => card.uid === opponentB.uid), restoredDrop.session.state)).toBe(1400);
    expect(currentAttack(restoredDrop.session.state.cards.find((card) => card.uid === opponentFaceDown.uid), restoredDrop.session.state)).toBe(1800);
    expect(restoredDrop.session.state.effects.filter((effect) => effect.code === effectUpdateAttack && [opponentA.uid, opponentB.uid].includes(effect.sourceUid)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: opponentA.uid, value: -1200 },
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: opponentB.uid, value: -1200 },
    ]);
    expect(restoredDrop.session.state.cards.find((card) => card.uid === staff.uid)).toMatchObject({ location: "spellTrapZone", equippedToUid: equipped.uid, cardTargetUids: [equipped.uid] });

    const restoredLeaveOpen = createRestoredEquippedOpen(reader, workspace, 21438287);
    expectCleanRestore(restoredLeaveOpen);
    expectRestoredLegalActions(restoredLeaveOpen, 0);
    const leavingStaff = requireCard(restoredLeaveOpen.session, staffCode);
    const leavingEquipped = requireCard(restoredLeaveOpen.session, equippedCode);
    destroyDuelCard(restoredLeaveOpen.session.state, leavingStaff.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredLeaveOpen.session.state.cards.find((card) => card.uid === leavingStaff.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: leavingEquipped.uid,
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(restoredLeaveOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-1015", eventCardUid: leavingStaff.uid, eventCode: eventLeaveField, eventName: "leftField", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, player: 0, sourceUid: leavingStaff.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredLeaveOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const returnToHand = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === leavingStaff.uid && action.effectId === "lua-4-1015");
    expect(returnToHand, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, returnToHand!);
    expect(restoredTrigger.session.state.players[0].lifePoints).toBe(7000);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === leavingStaff.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: leavingStaff.uid,
      reasonEffectId: 4,
    });
    expect(restoredTrigger.host.messages).toContain(`confirmed 1: ${staffCode}`);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "lifePointCostPaid", "becameTarget", "sentToHand", "confirmed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: leavingStaff.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventName: "lifePointCostPaid", eventCode: 1201, eventCardUid: undefined, eventPlayer: 0, eventValue: 1000, eventReason: duelReason.cost, eventReasonCardUid: leavingStaff.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: leavingStaff.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonCardUid: leavingStaff.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: leavingStaff.uid, eventPlayer: 1, eventValue: 1, eventReason: duelReason.effect, eventReasonCardUid: leavingStaff.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredEquippedOpen(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, seed: number): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [staffCode, equippedCode] }, 1: { main: [opponentACode, opponentBCode, opponentFaceDownCode] } });
  startDuel(session);
  const staff = requireCard(session, staffCode);
  const equipped = moveFaceUpAttack(session, requireCard(session, equippedCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, opponentACode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentBCode), 1, 1);
  const faceDown = moveDuelCard(session.state, requireCard(session, opponentFaceDownCode).uid, "monsterZone", 1);
  faceDown.faceUp = false;
  faceDown.position = "faceDownDefense";
  faceDown.sequence = 2;
  moveFaceUpEquip(session, staff, 0, equipped.uid);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(staffCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Archfiend's Staff of Despair");
  expect(script).toContain("aux.AddEquipProcedure(c,0)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetRange(LOCATION_SZONE)");
  expect(script).toContain("local v=(ec:GetAttack()//2)*-1");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("for tc in aux.Next(g) do");
  expect(script).toContain("e:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e:SetValue(v)");
  expect(script).toContain("e2:SetCode(EVENT_LEAVE_FIELD)");
  expect(script).toContain("e2:SetCost(Cost.PayLP(1000))");
  expect(script).toContain("return c:IsLocation(LOCATION_GRAVE) and c:GetEquipTarget()~=nil");
  expect(script).toContain("c:CreateEffectRelation(e)");
  expect(script).toContain("Duel.SendtoHand(c,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,c)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const staff = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === staffCode);
  expect(staff).toBeDefined();
  return [
    { ...staff!, kind: "spell", typeFlags: typeSpell | typeEquip },
    { code: equippedCode, name: "Staff Equipped Fiend", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 6, attack: 2400, defense: 1000 },
    { code: opponentACode, name: "Staff Opponent Face-up A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: opponentBCode, name: "Staff Opponent Face-up B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 2600, defense: 1000 },
    { code: opponentFaceDownCode, name: "Staff Opponent Facedown", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
  ];
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

function moveFaceUpEquip(session: DuelSession, card: DuelCardInstance, player: PlayerId, equippedToUid: string): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.equippedToUid = equippedToUid;
  moved.cardTargetUids = [equippedToUid];
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
