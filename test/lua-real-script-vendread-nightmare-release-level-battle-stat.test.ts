import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const nightmareCode = "33971095";
const vendreadCostCode = "339710950";
const levelTargetCode = "339710951";
const ritualAttackerCode = "339710952";
const opponentCode = "339710953";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNightmareScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${nightmareCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeRitual = 0x80;
const typeContinuous = 0x10000;
const raceZombie = 0x10;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;
const setVendread = 0x106;
const effectUpdateAttack = 100;
const effectUpdateLevel = 130;

describe.skipIf(!hasUpstreamScripts || !hasNightmareScript)("Lua real script Vendread Nightmare release level battle stat", () => {
  it("restores ReleaseCheckTarget Level gain and battle-destroying Ritual ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${nightmareCode}.lua`));
    const reader = createCardReader(cards());

    const restoredLevel = createRestoredLevelWindow({ reader, workspace });
    expectCleanRestore(restoredLevel);
    expectRestoredLegalActions(restoredLevel, 0);
    const nightmare = requireCard(restoredLevel.session, nightmareCode);
    const vendreadCost = requireCard(restoredLevel.session, vendreadCostCode);
    const levelTarget = requireCard(restoredLevel.session, levelTargetCode);
    const levelAction = getLuaRestoreLegalActions(restoredLevel, 0).find((action) => action.type === "activateEffect" && action.uid === nightmare.uid && action.effectId === "lua-2");
    expect(levelAction, JSON.stringify(getLuaRestoreLegalActions(restoredLevel, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLevel, levelAction!);
    passRestoredChain(restoredLevel);
    expect(restoredLevel.session.state.cards.find((card) => card.uid === vendreadCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: nightmare.uid,
      reasonEffectId: 2,
    });
    expect(currentLevel(restoredLevel.session.state.cards.find((card) => card.uid === levelTarget.uid), restoredLevel.session.state)).toBe(5);
    expect(restoredLevel.session.state.effects.filter((effect) => effect.sourceUid === levelTarget.uid && effect.code === effectUpdateLevel).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateLevel, reset: { flags: 1107169792 }, sourceUid: levelTarget.uid, value: 1 },
    ]);
    expect(restoredLevel.session.state.eventHistory.filter((event) => ["released", "becameTarget"].includes(event.eventName))).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: vendreadCost.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: nightmare.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: levelTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
    expect(restoredLevel.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredBattle = createRestoredBattleWindow({ reader, workspace });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const battleNightmare = requireCard(restoredBattle.session, nightmareCode);
    const ritualAttacker = requireCard(restoredBattle.session, ritualAttackerCode);
    const opponent = requireCard(restoredBattle.session, opponentCode);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === ritualAttacker.uid && action.targetUid === opponent.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passBattle(restoredBattle);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    const battleTrigger = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "activateTrigger" && action.uid === battleNightmare.uid);
    expect(battleTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, battleTrigger!);
    passRestoredChain(restoredBattle);
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === ritualAttacker.uid), restoredBattle.session.state)).toBe(3400);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === ritualAttacker.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 33427456 }, sourceUid: ritualAttacker.uid, value: 1000 },
    ]);
    expect(restoredBattle.session.state.eventHistory.filter((event) => ["attackDeclared", "destroyed", "battleDestroyed"].includes(event.eventName)).map((event) => ({
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
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: ritualAttacker.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponent.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: ritualAttacker.uid,
        eventReasonEffectId: undefined,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: opponent.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: ritualAttacker.uid,
        eventReasonEffectId: undefined,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 1400 });
  });
});

function createRestoredLevelWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 33971095, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [nightmareCode, vendreadCostCode, levelTargetCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpSpell(session, requireCard(session, nightmareCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, vendreadCostCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, levelTargetCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(nightmareCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredBattleWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 33971096, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [nightmareCode, ritualAttackerCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  moveFaceUpSpell(session, requireCard(session, nightmareCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, ritualAttackerCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, opponentCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(nightmareCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e2:SetCategory(CATEGORY_LVCHANGE)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.lvcfilter,1,true,aux.ReleaseCheckTarget,nil,tg)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.lvcfilter,1,99,true,aux.ReleaseCheckTarget,nil,tg)");
  expect(script).toContain("e:SetLabel(#g)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,s.lvfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_LEVEL)");
  expect(script).toContain("e1:SetValue(e:GetLabel())");
  expect(script).toContain("e3:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("a:IsRitualMonster() and a:IsSetCard(SET_VENDREAD)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
}

function cards(): DuelCardData[] {
  return [
    { code: nightmareCode, name: "Vendread Nightmare", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: vendreadCostCode, name: "Vendread Nightmare Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 1200, defense: 1000, setcodes: [setVendread] },
    { code: levelTargetCode, name: "Vendread Nightmare Level Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1500, defense: 1000 },
    { code: ritualAttackerCode, name: "Vendread Nightmare Ritual Attacker", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, race: raceZombie, attribute: attributeDark, level: 6, attack: 2400, defense: 0, setcodes: [setVendread] },
    { code: opponentCode, name: "Vendread Nightmare Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
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

function passBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passAttack" || candidate.type === "passDamage" || candidate.type === "passChain");
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
}
