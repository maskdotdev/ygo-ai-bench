import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { CardPosition, DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const goyoCode = "59255742";
const battleTargetCode = "592557420";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGoyoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${goyoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeSynchro = 0x2000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const eventBattleDestroying = 1139;
const eventBattleDestroyed = 1140;
const eventSpecialSummonSuccess = 1102;
const eventLeaveField = 1015;

describe.skipIf(!hasUpstreamScripts || !hasGoyoScript)("Lua real script Goyo Emperor battle revive", () => {
  it("restores battle-destroying SetTargetCard into Special Summoning the destroyed monster", () => {
    const { workspace, reader, session } = createFixture(59255742);
    expectScriptShape(workspace.readScript(`official/c${goyoCode}.lua`) ?? "");
    const goyo = requireCard(session, goyoCode);
    const target = requireCard(session, battleTargetCode);
    moveMonster(session, goyo, 0, "faceUpAttack", 0).summonType = "fusion";
    moveMonster(session, target, 1, "faceUpAttack", 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    registerGoyo(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === goyo.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", id: "lua-1-31", range: ["monsterZone"] },
      { category: 0x200, code: eventBattleDestroying, event: "trigger", id: `lua-2-${eventBattleDestroying}`, range: ["monsterZone"] },
      { category: 0x200, code: eventBattleDestroyed, event: "trigger", id: `lua-3-${eventBattleDestroyed}`, range: ["monsterZone"] },
      { category: 0x2000, code: eventSpecialSummonSuccess, event: "trigger", id: `lua-4-${eventSpecialSummonSuccess}`, range: ["monsterZone"] },
      { category: undefined, code: eventLeaveField, event: "trigger", id: `lua-5-${eventLeaveField}`, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
    ]);

    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === goyo.uid && action.targetUid === target.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    passBattleUntilPendingTrigger(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: goyo.uid,
    });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventName: trigger.eventName,
      eventCode: trigger.eventCode,
      eventCardUid: trigger.eventCardUid,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: `lua-2-${eventBattleDestroying}`, eventName: "battleDestroyed", eventCode: eventBattleDestroying, eventCardUid: goyo.uid, player: 0, sourceUid: goyo.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const revive = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === goyo.uid && action.effectId === `lua-2-${eventBattleDestroying}`
    );
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, revive!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: goyo.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["battleDestroyed", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "battleDestroyed", eventCardUid: target.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: goyo.uid, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "specialSummoned", eventCardUid: target.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: goyo.uid, eventReasonEffectId: 2, previous: "graveyard", current: "monsterZone" },
    ]);
  });
});

function createFixture(seed: number): {
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  reader: ReturnType<typeof createCardReader>;
  session: DuelSession;
} {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [goyoCode] }, 1: { main: [battleTargetCode] } });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: goyoCode, name: "Goyo Emperor", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceWarrior, attribute: attributeEarth, level: 10, attack: 3300, defense: 2500, fusionMaterialMin: 2, fusionMaterialMax: 2, fusionMaterialRace: raceWarrior, fusionMaterialAttribute: attributeEarth, fusionMaterialType: typeSynchro },
    { code: battleTargetCode, name: "Goyo Emperor Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("Goyo Emperor");
  expect(script).toContain("Fusion.AddProcMixN(c,true,true,s.ffilter,2)");
  expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYED)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetTargetCard(bc)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,nil,nil)");
  expect(script).toContain("local g=Duel.GetTargetCards(e)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_CONTROL)");
}

function registerGoyo(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(goyoCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId, position: CardPosition, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = position;
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

function passBattleUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
