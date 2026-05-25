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
const corneredCode = "84389640";
const smallNormalCode = "843896400";
const defenderCode = "843896401";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasCorneredScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${corneredCode}.lua`));
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const raceBeast = 0x4000;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const resetStandardPhaseEnd = 1107169792;
const promptOverrides = [{ api: "AnnounceNumber" as const, player: 0 as const, returned: 300 }];

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasCorneredScript)("Lua real script Attack of the Cornered Rat LP cost damage step stat", () => {
  it("restores Damage Step AnnounceNumber LP payment into opponent ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${corneredCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredBattle = createRestoredBattleField({ reader, workspace });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const rat = requireCard(restoredBattle.session, corneredCode);
    const attacker = requireCard(restoredBattle.session, smallNormalCode);
    const defender = requireCard(restoredBattle.session, defenderCode);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passUntilBattleWindow(restoredBattle, "beforeDamageCalculation");
    if (restoredBattle.session.state.waitingFor === 1) {
      const opponentPass = getLuaRestoreLegalActions(restoredBattle, 1).find((action) => action.type === "passDamage");
      expect(opponentPass, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
      applyRestoredActionAndAssert(restoredBattle, opponentPass!);
    }

    const drop = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "activateEffect" && action.uid === rat.uid && action.effectId === "lua-2-1002"
    );
    expect(drop, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, drop!);
    resolveRestoredChain(restoredBattle);

    expect(restoredBattle.host.promptDecisions.map((prompt) => ({
      api: prompt.api,
      options: "options" in prompt ? prompt.options : undefined,
      player: prompt.player,
      returned: "returned" in prompt ? prompt.returned : undefined,
    }))).toEqual([
      { api: "AnnounceNumber", options: Array.from({ length: 9 }, (_, index) => (index + 1) * 100), player: 0, returned: 300 },
    ]);
    expect(restoredBattle.session.state.players[0].lifePoints).toBe(7700);
    expect(currentAttack(findCard(restoredBattle.session, defender.uid), restoredBattle.session.state)).toBe(600);
    expect(restoredBattle.session.state.effects.filter((effect) =>
      effect.sourceUid === defender.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      ownerPlayer: effect.ownerPlayer,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, ownerPlayer: 0, reset: { flags: resetStandardPhaseEnd }, sourceUid: defender.uid, value: -300 },
    ]);
    expect(restoredBattle.session.state.flagEffects.map((flag) => ({
      code: flag.code,
      ownerId: flag.ownerId,
      ownerType: flag.ownerType,
      reset: flag.reset,
      resetCount: flag.resetCount,
      value: flag.value,
    }))).toContainEqual({
      code: Number(corneredCode),
      ownerId: rat.uid,
      ownerType: "card",
      reset: 0x40000020,
      resetCount: 1,
      value: 0,
    });
    expect(restoredBattle.session.state.eventHistory.filter((event) => ["becameTarget", "lifePointCostPaid"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventValue: event.eventValue,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "lifePointCostPaid", eventCardUid: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: rat.uid, eventReasonEffectId: 2, eventValue: 300, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCardUid: defender.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventValue: undefined, relatedEffectId: 2 },
    ]);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const cornered = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === corneredCode);
  expect(cornered).toBeDefined();
  return [
    { ...cornered!, kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: smallNormalCode, name: "Cornered Rat Small Normal", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceBeast, attribute: attributeEarth, level: 2, attack: 500, defense: 500 },
    { code: defenderCode, name: "Cornered Rat Defender", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeDark, level: 4, attack: 900, defense: 1000 },
  ];
}

function createRestoredBattleField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 84389640, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [corneredCode, smallNormalCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  const rat = requireCard(session, corneredCode);
  const attacker = requireCard(session, smallNormalCode);
  const defender = requireCard(session, defenderCode);
  moveFaceUpSpellTrap(session, rat, 0, 0);
  moveFaceUpAttack(session, attacker, 0, 0);
  moveFaceUpAttack(session, defender, 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(corneredCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Attack of the Cornered Rat");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("Duel.GetCurrentPhase()");
  expect(script).toContain("Duel.IsDamageCalculated()");
  expect(script).toContain("Duel.GetAttacker()");
  expect(script).toContain("Duel.GetAttackTarget()");
  expect(script).toContain("Duel.IsPlayerAffectedByEffect(tp,EFFECT_LPCOST_CHANGE)");
  expect(script).toContain("Duel.CheckLPCost(tp,100)");
  expect(script).toContain("Duel.AnnounceNumber(tp,table.unpack(t))");
  expect(script).toContain("Duel.PayLPCost(tp,pay)");
  expect(script).toContain("Duel.SetTargetCard(tc)");
  expect(script).toContain("e1:SetOwnerPlayer(tp)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel())");
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

function passUntilBattleWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, kind: NonNullable<DuelSession["state"]["battleWindow"]>["kind"]): void {
  let guard = 0;
  while (restored.session.state.battleWindow?.kind !== kind) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain" || action.type === "passAttack" || action.type === "passDamage");
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
