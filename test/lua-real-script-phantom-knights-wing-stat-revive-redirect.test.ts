import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const wingCode = "98431356";
const targetCode = "984313560";
const phantomCode = "984313561";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasWingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${wingCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const setThePhantomKnights = 0x10db;

describe.skipIf(!hasUpstreamScripts || !hasWingScript)("Lua real script Phantom Knights' Wing stat revive redirect", () => {
  it("restores Damage Step target protection and grave self-banish revive with leave-field redirect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${wingCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 98431356, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wingCode, targetCode, phantomCode] }, 1: { main: [] } });
    startDuel(session);

    const wing = requireCard(session, wingCode);
    const target = requireCard(session, targetCode);
    const phantom = requireCard(session, phantomCode);
    moveFaceDownTrap(session, wing);
    moveFaceUpAttack(session, target, 0);
    moveDuelCard(session.state, phantom.uid, "graveyard", 0).faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wingCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === wing.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    passRestoredChain(restoredOpen);

    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid)!, restoredOpen.session.state)).toBe(2300);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === target.uid && (effect.code === 47 || effect.code === 100)).map((effect) => ({
      code: effect.code,
      countLimit: effect.countLimit,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, countLimit: undefined, property: 0x400, reset: { flags: 33427456 }, sourceUid: target.uid, value: 500 },
      { code: 47, countLimit: 1, property: 0x400, reset: { flags: 1107169792 }, sourceUid: target.uid, value: undefined },
    ]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: target.uid, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonPlayer: 0 },
    ]);

    const firstDestroy = destroyDuelCard(restoredOpen.session.state, target.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(firstDestroy).toMatchObject({ location: "monsterZone", uid: target.uid });
    const secondDestroy = destroyDuelCard(restoredOpen.session.state, target.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(secondDestroy).toMatchObject({ location: "graveyard", reason: duelReason.effect | duelReason.destroy, uid: target.uid });

    const restoredReviveWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredReviveWindow);
    expectRestoredLegalActions(restoredReviveWindow, 0);
    const revive = getLuaRestoreLegalActions(restoredReviveWindow, 0).find((action) => action.type === "activateEffect" && action.uid === wing.uid);
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredReviveWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredReviveWindow, revive!);
    passRestoredChain(restoredReviveWindow);

    expect(restoredReviveWindow.session.state.cards.find((card) => card.uid === wing.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonCardUid: wing.uid,
      reasonEffectId: 2,
      reasonPlayer: 0,
    });
    expect(restoredReviveWindow.session.state.cards.find((card) => card.uid === phantom.uid)).toMatchObject({
      controller: 0,
      faceUp: true,
      location: "monsterZone",
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: wing.uid,
      reasonEffectId: 2,
      reasonPlayer: 0,
      summonType: "special",
    });
    expect(restoredReviveWindow.session.state.effects.filter((effect) => effect.sourceUid === phantom.uid && effect.code === 60).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 60, property: 67109888, range: ["monsterZone"], reset: { flags: 209326080 }, sourceUid: phantom.uid, value: 0x20 },
    ]);
    expect(restoredReviveWindow.session.state.eventHistory.filter((event) => event.eventName === "banished" || event.eventName === "specialSummoned").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: wing.uid, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: wing.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: phantom.uid, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: wing.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
    ]);

    const restoredRedirect = restoreDuelWithLuaScripts(serializeDuel(restoredReviveWindow.session), workspace, reader);
    expectCleanRestore(restoredRedirect);
    expectRestoredLegalActions(restoredRedirect, 0);
    destroyDuelCard(restoredRedirect.session.state, phantom.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredRedirect.session.state.cards.find((card) => card.uid === phantom.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.effect | duelReason.destroy | duelReason.redirect,
      reasonPlayer: 0,
    });
    expect(restoredRedirect.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,g,1,0,0)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_COUNT)");
  expect(script).toContain("e2:SetCountLimit(1)");
  expect(script).toContain("e2:SetValue(s.valcon)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return c:IsSetCard(SET_THE_PHANTOM_KNIGHTS) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,0,0)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("e1:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e1:SetValue(LOCATION_REMOVED)");
}

function cards(): DuelCardData[] {
  return [
    { code: wingCode, name: "Phantom Knights' Wing", kind: "trap", typeFlags: typeTrap },
    { code: targetCode, name: "Phantom Knights' Wing Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
    { code: phantomCode, name: "Phantom Knights' Wing Phantom", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setThePhantomKnights], level: 4, attack: 1600, defense: 1200 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceDownTrap(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
