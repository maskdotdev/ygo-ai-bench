import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const barkCode = "41925941";
const fiendCode = "419259410";
const attackerCode = "419259411";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasBarkScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${barkCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const raceWarrior = 0x1;
const raceFiend = 0x8;
const attributeDark = 0x20;
const attributeEarth = 0x10;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;
const resetStandardPhaseEnd = 1107169792;
const promptOverrides = [{ api: "AnnounceNumber" as const, player: 0 as const, returned: 1200 }];

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasBarkScript)("Lua real script Bark of Dark Ruler LP cost battle stat", () => {
  it("restores Damage Step AnnounceNumber LP payment into opposing battler ATK/DEF loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${barkCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredBattle({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    const bark = requireCard(restored.session, barkCode);
    const fiend = requireCard(restored.session, fiendCode);
    const attacker = requireCard(restored.session, attackerCode);
    const attack = getLuaRestoreLegalActions(restored, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === fiend.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, attack!);
    passUntilBattleWindow(restored, "beforeDamageCalculation");
    if (restored.session.state.waitingFor === 1) {
      const opponentPass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passDamage");
      expect(opponentPass, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
      applyRestoredActionAndAssert(restored, opponentPass!);
    }

    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === bark.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(restored.host.promptDecisions.map((prompt) => ({
      api: prompt.api,
      options: "options" in prompt ? prompt.options : undefined,
      player: prompt.player,
      returned: "returned" in prompt ? prompt.returned : undefined,
    }))).toEqual([
      { api: "AnnounceNumber", options: Array.from({ length: 25 }, (_, index) => (index + 1) * 100), player: 0, returned: 1200 },
    ]);
    expect(restored.session.state.players[0].lifePoints).toBe(6800);
    expect(currentAttack(findCard(restored.session, attacker.uid), restored.session.state)).toBe(1300);
    expect(currentDefense(findCard(restored.session, attacker.uid), restored.session.state)).toBe(600);
    expect(currentAttack(findCard(restored.session, fiend.uid), restored.session.state)).toBe(1600);
    expect(restored.session.state.effects.filter((effect) =>
      effect.sourceUid === attacker.uid && effect.code !== undefined && [effectUpdateAttack, effectUpdateDefense].includes(effect.code)
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: attacker.uid, value: -1200 },
      { code: effectUpdateDefense, reset: { flags: resetStandardPhaseEnd }, sourceUid: attacker.uid, value: -1200 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["attackDeclared", "becameTarget", "lifePointCostPaid"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventValue: event.eventValue,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "attackDeclared", eventCardUid: attacker.uid, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventValue: undefined, relatedEffectId: undefined },
      { eventName: "lifePointCostPaid", eventCardUid: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: bark.uid, eventReasonEffectId: 1, eventValue: 1200, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCardUid: attacker.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventValue:  1, relatedEffectId: 1 },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const bark = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === barkCode);
  expect(bark).toBeDefined();
  return [
    { ...bark!, kind: "trap", typeFlags: typeTrap },
    { code: fiendCode, name: "Bark of Dark Ruler Fiend", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1600, defense: 2000 },
    { code: attackerCode, name: "Bark of Dark Ruler Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2500, defense: 1800 },
  ];
}

function createRestoredBattle({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 41925941, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [barkCode, fiendCode] }, 1: { main: [attackerCode] } });
  startDuel(session);
  moveFaceDownSpellTrap(session, requireCard(session, barkCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, fiendCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(barkCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Bark of Dark Ruler");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("Duel.GetCurrentPhase()");
  expect(script).toContain("Duel.IsDamageCalculated()");
  expect(script).toContain("local a=Duel.GetAttacker()");
  expect(script).toContain("local d=Duel.GetAttackTarget()");
  expect(script).toContain("d:IsFaceup() and d:IsRace(RACE_FIEND) and d:IsRelateToBattle()");
  expect(script).toContain("Duel.CheckLPCost(tp,100)");
  expect(script).toContain("Duel.AnnounceNumber(tp,table.unpack(t))");
  expect(script).toContain("Duel.PayLPCost(tp,cost)");
  expect(script).toContain("Duel.SetTargetCard(tc)");
  expect(script).toContain("Duel.SetTargetParam(cost)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PARAM)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-val)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
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

function moveFaceDownSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = false;
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
