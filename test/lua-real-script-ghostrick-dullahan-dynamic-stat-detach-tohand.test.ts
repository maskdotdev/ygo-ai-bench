import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dullahanCode = "46895036";
const allyCode = "468950360";
const materialCode = "468950361";
const opponentCode = "468950362";
const graveGhostrickCode = "468950363";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDullahanScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dullahanCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceFiend = 0x8;
const attributeDark = 0x20;
const setGhostrick = 0x8d;
const effectUpdateAttack = 100;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDullahanScript)("Lua real script Ghostrick Dullahan dynamic stat detach to hand", () => {
  it("restores field-count ATK, detach target halving, and delayed Ghostrick grave return confirmation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dullahanCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const restoredOpen = createRestoredOpen({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const dullahan = requireCard(restoredOpen.session, dullahanCode);
    const material = requireCard(restoredOpen.session, materialCode);
    const graveGhostrick = requireCard(restoredOpen.session, graveGhostrickCode);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === dullahan.uid), restoredOpen.session.state)).toBe(1400);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === dullahan.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", range: ["monsterZone"], sourceUid: dullahan.uid },
    ]);

    const quickStat = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === dullahan.uid);
    expect(quickStat, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, quickStat!);
    resolveRestoredChain(restoredOpen);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === dullahan.uid)?.overlayUids).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: dullahan.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === dullahan.uid), restoredOpen.session.state)).toBe(700);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 1107169792 }, sourceUid: dullahan.uid, value: 700 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["detachedMaterial", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: material.uid, eventCode: 1202, eventName: "detachedMaterial", eventReason: duelReason.cost, eventReasonCardUid: dullahan.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventCardUid: dullahan.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: 3 },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    sendDuelCardToGraveyard(restoredOpen.session.state, dullahan.uid, 0, duelReason.effect, 0);
    const restoredGrave = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredGrave);
    expectRestoredLegalActions(restoredGrave, 0);
    expect(restoredGrave.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-1014", eventCode: 1014, eventName: "sentToGraveyard", player: 0, sourceUid: dullahan.uid, triggerBucket: "turnOptional" },
    ]);
    const recover = getLuaRestoreLegalActions(restoredGrave, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === dullahan.uid && action.effectId === "lua-4-1014"
    );
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(restoredGrave, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredGrave, recover!);
    resolveRestoredChain(restoredGrave);
    expect(restoredGrave.session.state.cards.find((card) => card.uid === graveGhostrick.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: dullahan.uid,
      reasonEffectId: 4,
    });
    expect(restoredGrave.host.messages).toContain(`confirmed 1: ${graveGhostrickCode}`);
    expect(restoredGrave.session.state.eventHistory.filter((event) =>
      ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: graveGhostrick.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: dullahan.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
      { eventCardUid: graveGhostrick.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: dullahan.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
      { eventCardUid: graveGhostrick.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: dullahan.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
    ]);
    expect(restoredGrave.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 46895036, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [allyCode, materialCode, graveGhostrickCode], extra: [dullahanCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  const dullahan = requireCard(session, dullahanCode);
  moveFaceUpAttack(session, dullahan, 0, 0);
  dullahan.summonType = "xyz";
  dullahan.summonPlayer = 0;
  const material = requireCard(session, materialCode);
  moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0).sequence = 0;
  dullahan.overlayUids.push(material.uid);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentCode), 1, 0);
  moveFaceUpGrave(session, requireCard(session, graveGhostrickCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dullahanCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const dullahan = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === dullahanCode);
  expect(dullahan).toBeDefined();
  return [
    { ...dullahan!, kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceFiend, attribute: attributeDark, level: 1, attack: 1000, defense: 0, setcodes: [setGhostrick] },
    { code: allyCode, name: "Ghostrick Dullahan Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 1, attack: 800, defense: 1000, setcodes: [setGhostrick] },
    { code: materialCode, name: "Ghostrick Dullahan Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 1, attack: 600, defense: 600, setcodes: [setGhostrick] },
    { code: opponentCode, name: "Ghostrick Dullahan Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 2400, defense: 1000 },
    { code: graveGhostrickCode, name: "Ghostrick Dullahan Recovery", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 1, attack: 700, defense: 700, setcodes: [setGhostrick] },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Ghostrick Dullahan");
  expect(script).toContain("Xyz.AddProcedure(c,nil,1,2)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("Duel.GetMatchingGroupCount(s.atkfilter,c:GetControler(),LOCATION_ONFIELD,0,nil)*200");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e2:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("e2:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()/2)");
  expect(script).toContain("e3:SetCategory(CATEGORY_TOHAND)");
  expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,e:GetHandler())");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,tc)");
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

function moveFaceUpGrave(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "graveyard", player);
  moved.faceUp = true;
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
