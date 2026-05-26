import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { banishDuelCard, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const swordmasterCode = "5177985";
const shiranuiACode = "51779850";
const shiranuiBCode = "51779851";
const zombieTargetCode = "51779852";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSwordmasterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${swordmasterCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceZombie = 0x10;
const attributeFire = 0x4;
const setShiranui = 0xd9;
const effectLeaveFieldRedirect = 60;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasSwordmasterScript)("Lua real script Shiranui Swordmaster grave revive banish stat", () => {
  it("restores graveyard self-revive with leave-field redirect and banished Zombie ATK trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${swordmasterCode}.lua`));
    const reader = createCardReader(cards());

    const restoredRevive = createRestoredSwordmasterField({ reader, workspace });
    expectCleanRestore(restoredRevive);
    expectRestoredLegalActions(restoredRevive, 0);
    const graveSwordmaster = requireCard(restoredRevive.session, swordmasterCode);
    const revive = getLuaRestoreLegalActions(restoredRevive, 0).find((action) => action.type === "activateEffect" && action.uid === graveSwordmaster.uid && action.effectId === "lua-1");
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredRevive, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRevive, revive!);
    resolveRestoredChain(restoredRevive);

    expect(restoredRevive.session.state.cards.find((card) => card.uid === graveSwordmaster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: graveSwordmaster.uid,
      reasonEffectId: 1,
    });
    expect(restoredRevive.session.state.effects.filter((effect) => effect.sourceUid === graveSwordmaster.uid && effect.code === effectLeaveFieldRedirect).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: effectLeaveFieldRedirect, property: 0x400 | 0x4000000, reset: { flags: 209326080 }, sourceUid: graveSwordmaster.uid, value: 0x20 }]);
    expect(restoredRevive.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === graveSwordmaster.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: graveSwordmaster.uid,
        eventUids: [graveSwordmaster.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: graveSwordmaster.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 3 },
      },
    ]);

    const restoredRedirect = restoreDuelWithLuaScripts(serializeDuel(restoredRevive.session), workspace, reader);
    expectCleanRestore(restoredRedirect);
    expectRestoredLegalActions(restoredRedirect, 0);
    destroyDuelCard(restoredRedirect.session.state, graveSwordmaster.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredRedirect.session.state.cards.find((card) => card.uid === graveSwordmaster.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.effect | duelReason.destroy | duelReason.redirect,
      reasonPlayer: 0,
    });

    const restoredBanish = createRestoredSwordmasterField({ reader, workspace });
    expectCleanRestore(restoredBanish);
    const banishedSwordmaster = requireCard(restoredBanish.session, swordmasterCode);
    const zombieTarget = requireCard(restoredBanish.session, shiranuiACode);
    banishDuelCard(restoredBanish.session.state, banishedSwordmaster.uid, 0, duelReason.effect, 0);
    expect(restoredBanish.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1011", eventCardUid: banishedSwordmaster.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, player: 0, sourceUid: banishedSwordmaster.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBanish.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const atkTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === banishedSwordmaster.uid && action.effectId === "lua-2-1011");
    expect(atkTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, atkTrigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === zombieTarget.uid), restoredTrigger.session.state)).toBe(2100);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === zombieTarget.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: zombieTarget.uid, value: 600 }]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["banished", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: banishedSwordmaster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: zombieTarget.uid, eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 2 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("s.listed_series={SET_SHIRANUI}");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_SHIRANUI)");
  expect(script).toContain("and Duel.IsExistingMatchingCard(s.cfilter2,tp,LOCATION_MZONE,0,1,nil,c:GetCode())");
  expect(script).toContain("and e:GetHandler():IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("e1:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e1:SetValue(LOCATION_REMOVED)");
  expect(script).toContain("e2:SetCode(EVENT_REMOVE)");
  expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_ZOMBIE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(600)");
}

function cards(): DuelCardData[] {
  return [
    { code: swordmasterCode, name: "Shiranui Swordmaster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeFire, level: 2, attack: 600, defense: 0, setcodes: [setShiranui] },
    { code: shiranuiACode, name: "Shiranui Swordmaster Ally A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeFire, level: 4, attack: 1500, defense: 1000, setcodes: [setShiranui] },
    { code: shiranuiBCode, name: "Shiranui Swordmaster Ally B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeFire, level: 4, attack: 1600, defense: 1000, setcodes: [setShiranui] },
    { code: zombieTargetCode, name: "Shiranui Swordmaster Zombie Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeFire, level: 4, attack: 1200, defense: 1000 },
  ];
}

function createRestoredSwordmasterField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 5177985, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [swordmasterCode, shiranuiACode, shiranuiBCode, zombieTargetCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, swordmasterCode).uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, requireCard(session, shiranuiACode), 0);
  moveFaceUpAttack(session, requireCard(session, shiranuiBCode), 0);
  moveFaceUpAttack(session, requireCard(session, zombieTargetCode), 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(swordmasterCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
