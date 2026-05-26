import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dreadServantCode = "36625827";
const clockTowerCode = "75041269";
const attackerCode = "366258270";
const spellTargetCode = "366258271";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDreadServantScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dreadServantCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const clockCounter = 0x1b;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDreadServantScript)("Lua real script Destiny HERO - Dread Servant counter destroy", () => {
  it("restores summon Clock Counter placement and battle-destroyed Spell/Trap destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dreadServantCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredSummon = createRestoredSummonState(reader, workspace);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const dreadServant = requireCard(restoredSummon.session, dreadServantCode);
    const ownClockTower = requireControlledCard(restoredSummon.session, clockTowerCode, 0);
    const opponentClockTower = requireControlledCard(restoredSummon.session, clockTowerCode, 1);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === dreadServant.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);

    const restoredCounter = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredCounter);
    expectRestoredLegalActions(restoredCounter, 0);
    const counterTrigger = getLuaRestoreLegalActions(restoredCounter, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === dreadServant.uid && action.effectId?.endsWith("-1100")
    );
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredCounter, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounter, counterTrigger!);
    expect(restoredCounter.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredCounter);
    expect(getDuelCardCounter(findCard(restoredCounter.session, ownClockTower.uid), clockCounter)).toBe(1);
    expect(getDuelCardCounter(findCard(restoredCounter.session, opponentClockTower.uid), clockCounter)).toBe(1);
    expect(restoredCounter.session.state.eventHistory.filter((event) => ["normalSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: dreadServant.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: ownClockTower.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: dreadServant.uid, eventReasonEffectId: 1 },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: opponentClockTower.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: dreadServant.uid, eventReasonEffectId: 1 },
    ]);

    const restoredBattle = createRestoredBattleState(reader, workspace);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const battledDreadServant = requireCard(restoredBattle.session, dreadServantCode);
    const attacker = requireCard(restoredBattle.session, attackerCode);
    const spellTarget = requireCard(restoredBattle.session, spellTargetCode);
    attackAndReachBattleDestroyedTrigger(restoredBattle, 1, attacker.uid, battledDreadServant.uid);
    expect(findCard(restoredBattle.session, battledDreadServant.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: attacker.uid,
    });

    const restoredDestroy = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 0);
    const destroyTrigger = getLuaRestoreLegalActions(restoredDestroy, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === battledDreadServant.uid && action.effectId?.endsWith("-1140")
    );
    expect(destroyTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroy, destroyTrigger!);
    expect(restoredDestroy.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredDestroy);
    expect(findCard(restoredDestroy.session, spellTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: battledDreadServant.uid,
      reasonEffectId: 2,
    });
    expect(restoredDestroy.session.state.eventHistory.filter((event) => ["battleDestroyed", "becameTarget", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: battledDreadServant.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: attacker.uid, eventReasonEffectId: undefined, relatedEffectId: undefined },
      { eventName: "battleDestroyed", eventCode: 1140, eventCardUid: battledDreadServant.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: attacker.uid, eventReasonEffectId: undefined, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: spellTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2 },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: spellTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: battledDreadServant.uid, eventReasonEffectId: 2, relatedEffectId: undefined },
    ]);
  });
});

function createRestoredSummonState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 36625827, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [dreadServantCode, clockTowerCode] }, 1: { main: [clockTowerCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, dreadServantCode).uid, "hand", 0);
  moveFaceUpSpellTrap(session, requireCard(session, clockTowerCode), 0, 0);
  moveFaceUpSpellTrap(session, requireControlledCard(session, clockTowerCode, 1), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerDreadServant(session, workspace, 3);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredBattleState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 36625828, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [dreadServantCode, spellTargetCode] }, 1: { main: [attackerCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, dreadServantCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 1, 0);
  moveFaceUpSpellTrap(session, requireCard(session, spellTargetCode), 0, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  registerDreadServant(session, workspace, 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const dreadServant = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === dreadServantCode);
  const clockTower = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === clockTowerCode);
  expect(dreadServant).toBeDefined();
  expect(clockTower).toBeDefined();
  return [
    dreadServant!,
    clockTower!,
    { code: attackerCode, name: "Dread Servant Battle Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: spellTargetCode, name: "Dread Servant Spell Target", kind: "spell", typeFlags: typeSpell },
  ];
}

function registerDreadServant(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, expectedEffects: number): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dreadServantCode), workspace).ok).toBe(true);
  expect(host.loadCardScript(Number(clockTowerCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(expectedEffects);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Destiny HERO - Dread Servant");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.GetFieldCard(tp,LOCATION_FZONE,0)");
  expect(script).toContain("tc:AddCounter(0x1b,1)");
  expect(script).toContain("Duel.GetFieldCard(1-tp,LOCATION_FZONE,0)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYED)");
  expect(script).toContain("return e:GetHandler():IsLocation(LOCATION_GRAVE) and e:GetHandler():IsReason(REASON_BATTLE)");
  expect(script).toContain("chkc:IsOnField() and chkc:IsControler(tp) and chkc:IsSpellTrap()");
  expect(script).toContain("Duel.IsExistingTarget(Card.IsSpellTrap,tp,LOCATION_ONFIELD,0,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsSpellTrap,tp,LOCATION_ONFIELD,0,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function requireControlledCard(session: DuelSession, code: string, controller: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.controller === controller);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
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

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.sequence = sequence;
  return moved;
}

function attackAndReachBattleDestroyedTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, attackerUid: string, targetUid: string): void {
  const attack = getLuaRestoreLegalActions(restored, player).find((action) =>
    action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid
  );
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, attack!);
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const actionPlayer = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, actionPlayer).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, actionPlayer), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
