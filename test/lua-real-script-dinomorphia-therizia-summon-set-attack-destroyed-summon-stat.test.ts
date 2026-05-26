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
const theriziaCode = "92133240";
const dinomorphiaTrapCode = "921332400";
const reviveTargetCode = "921332401";
const costTrapCode = "921332402";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasTheriziaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${theriziaCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceDinosaur = 0x10000;
const attributeDark = 0x20;
const setDinomorphia = 0x175;
const effectUpdateAttack = 100;
const resetEventStandardDisable = 33492992;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasTheriziaScript)("Lua real script Dinomorphia Therizia summon set attack destroyed summon stat", () => {
  it("restores summon Trap Set with low-LP ATK gain and destroyed trap-cost revival", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectTheriziaScriptShape(workspace.readScript(`official/c${theriziaCode}.lua`));
    const theriziaData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === theriziaCode);
    expect(theriziaData).toBeDefined();
    const reader = createCardReader([{ ...theriziaData!, setcodes: [setDinomorphia] }, ...fixtureCards()]);

    const restoredSummonOpen = createRestoredSummonWindow({ reader, workspace });
    expectCleanRestore(restoredSummonOpen);
    expectRestoredLegalActions(restoredSummonOpen, 0);
    const therizia = requireCard(restoredSummonOpen.session, theriziaCode);
    const setTrap = requireCard(restoredSummonOpen.session, dinomorphiaTrapCode);
    const summon = getLuaRestoreLegalActions(restoredSummonOpen, 0).find((action) => action.type === "normalSummon" && action.uid === therizia.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonOpen, summon!);
    expect(restoredSummonOpen.session.state.pendingTriggers.map((trigger) => ({
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
      { effectId: "lua-1-1100", eventCardUid: therizia.uid, eventCode: 1100, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonPlayer: 0, player: 0, sourceUid: therizia.uid, triggerBucket: "turnOptional" },
    ]);
    const setBoost = getLuaRestoreLegalActions(restoredSummonOpen, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === therizia.uid && action.effectId === "lua-1-1100"
    );
    expect(setBoost, JSON.stringify(getLuaRestoreLegalActions(restoredSummonOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonOpen, setBoost!);
    resolveRestoredChain(restoredSummonOpen);

    expect(restoredSummonOpen.session.state.cards.find((card) => card.uid === setTrap.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: false,
      position: "faceDown",
    });
    expect(currentAttack(restoredSummonOpen.session.state.cards.find((card) => card.uid === therizia.uid), restoredSummonOpen.session.state)).toBe(2000);
    expect(restoredSummonOpen.session.state.effects.filter((effect) => effect.sourceUid === therizia.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: resetEventStandardDisable }, sourceUid: therizia.uid, value: 500 },
    ]);
    expect(restoredSummonOpen.session.state.eventHistory.filter((event) => ["normalSummoned", "spellTrapSet", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: therizia.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "spellTrapSet",
        eventCode: 1107,
        eventCardUid: setTrap.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
      chainSolvedEvent(1, "chain-3"),
    ]);

    const restoredDestroyedOpen = createRestoredDestroyedWindow({ reader, workspace });
    expectCleanRestore(restoredDestroyedOpen);
    const destroyedTherizia = requireCard(restoredDestroyedOpen.session, theriziaCode);
    const reviveTarget = requireCard(restoredDestroyedOpen.session, reviveTargetCode);
    const costTrap = requireCard(restoredDestroyedOpen.session, costTrapCode);
    destroyDuelCard(restoredDestroyedOpen.session.state, destroyedTherizia.uid, 0, duelReason.effect | duelReason.destroy, 0);
    const restoredDestroyedTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyedOpen.session), workspace, reader);
    expectCleanRestore(restoredDestroyedTrigger);
    expectRestoredLegalActions(restoredDestroyedTrigger, 0);
    expect(restoredDestroyedTrigger.session.state.pendingTriggers.map((trigger) => ({
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
      { effectId: "lua-3-1029", eventCardUid: destroyedTherizia.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, player: 0, sourceUid: destroyedTherizia.uid, triggerBucket: "turnOptional" },
    ]);
    const revive = getLuaRestoreLegalActions(restoredDestroyedTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === destroyedTherizia.uid && action.effectId === "lua-3-1029"
    );
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyedTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyedTrigger, revive!);
    resolveRestoredChain(restoredDestroyedTrigger);

    expect(restoredDestroyedTrigger.session.state.cards.find((card) => card.uid === costTrap.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: destroyedTherizia.uid,
      reasonEffectId: 3,
    });
    expect(restoredDestroyedTrigger.session.state.cards.find((card) => card.uid === reviveTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: destroyedTherizia.uid,
      reasonEffectId: 3,
    });
    expect(restoredDestroyedTrigger.session.state.eventHistory.filter((event) => ["destroyed", "banished", "specialSummoned", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyedTherizia.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 2 },
      },
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: costTrap.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyedTherizia.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: reviveTarget.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyedTherizia.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventUids: [reviveTarget.uid],
      },
      chainSolvedEvent(3, "chain-4"),
    ]);
    expect(restoredDestroyedTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredSummonWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 92133240, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [theriziaCode, dinomorphiaTrapCode] }, 1: { main: [] } });
  startDuel(session);
  session.state.players[0].lifePoints = 2000;
  moveDuelCard(session.state, requireCard(session, theriziaCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerTherizia(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDestroyedWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 92133241, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [theriziaCode, reviveTargetCode, costTrapCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, theriziaCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, reviveTargetCode).uid, "graveyard", 0).faceUp = true;
  moveDuelCard(session.state, requireCard(session, costTrapCode).uid, "graveyard", 0).faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerTherizia(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function fixtureCards(): DuelCardData[] {
  return [
    { code: dinomorphiaTrapCode, name: "Dinomorphia Therizia Trap Set", kind: "trap", typeFlags: typeTrap, setcodes: [setDinomorphia] },
    { code: reviveTargetCode, name: "Dinomorphia Therizia Revive Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDinomorphia], race: raceDinosaur, attribute: attributeDark, level: 4, attack: 1200, defense: 0 },
    { code: costTrapCode, name: "Dinomorphia Therizia Cost Trap", kind: "trap", typeFlags: typeTrap },
  ];
}

function registerTherizia(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(theriziaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectTheriziaScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Dinomorphia Therizia");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_SET)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsSetCard(SET_DINOMORPHIA) and c:IsTrap() and c:IsSSetable()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.setfilter,tp,LOCATION_DECK,0,1,1,nil):GetFirst()");
  expect(script).toContain("Duel.SSet(tp,tc)>0 and Duel.GetLP(tp)<=2000");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
  expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("return (r&REASON_EFFECT+REASON_BATTLE)~=0");
  expect(script).toContain("return c:IsTrap() and c:IsAbleToRemoveAsCost()");
  expect(script).toContain("Duel.Remove(tg,POS_FACEUP,REASON_COST)");
  expect(script).toContain("return c:IsSetCard(SET_DINOMORPHIA) and c:IsLevelBelow(4) and not c:IsCode(id) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
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

function chainSolvedEvent(effectId: number, chainLinkId: string) {
  return {
    eventName: "chainSolved",
    eventCode: 1022,
    eventPlayer: 0,
    eventValue: 1,
    eventReasonPlayer: 0,
    relatedEffectId: effectId,
    eventChainDepth: 1,
    eventChainLinkId: chainLinkId,
  };
}
