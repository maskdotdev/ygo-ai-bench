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
const ratCode = "84389640";
const attackerCode = "843896400";
const defenderCode = "843896401";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRatScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ratCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeNormal = 0x10;
const typeContinuous = 0x20000;
const raceBeast = 0x4000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const resetStandardPhaseEnd = 1107169792;
const promptOverrides = [{ api: "AnnounceNumber" as const, player: 0 as const, returned: 700 }];

describe.skipIf(!hasUpstreamScripts || !hasRatScript)("Lua real script Attack of the Cornered Rat damage-step LP attack drop", () => {
  it("restores Damage Step AnnounceNumber LP cost into battle-target ATK loss and damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ratCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 84389640, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ratCode, attackerCode] }, 1: { main: [defenderCode] } });
    startDuel(session);
    const rat = requireCard(session, ratCode);
    const attacker = requireCard(session, attackerCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpSpellTrap(session, rat, 0, 0);
    moveFaceUpAttack(session, attacker, 0, 0);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ratCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    passUntilBattleWindow(restoredOpen, "beforeDamageCalculation");
    expect(restoredOpen.session.state.battleWindow).toMatchObject({ kind: "beforeDamageCalculation", step: "damage" });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "beforeDamageCalculation").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
    }))).toEqual([
      { eventCardUid: attacker.uid, eventCode: 1134, eventName: "beforeDamageCalculation", eventReason: 0, eventReasonPlayer: 0, eventUids: [attacker.uid, defender.uid] },
    ]);
    if (restoredOpen.session.state.waitingFor === 1) {
      const pass = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "passDamage");
      expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
      applyRestoredActionAndAssert(restoredOpen, pass!);
    }

    const drop = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === rat.uid
    );
    expect(drop, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, drop!);
    expect(restoredOpen.host.promptDecisions.map((prompt) => ({
      api: prompt.api,
      options: "options" in prompt ? prompt.options : undefined,
      player: prompt.player,
      returned: "returned" in prompt ? prompt.returned : undefined,
    }))).toEqual([
      { api: "AnnounceNumber", options: Array.from({ length: 12 }, (_, index) => (index + 1) * 100), player: 0, returned: 700 },
    ]);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.players[0].lifePoints).toBe(7300);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "lifePointCostPaid"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: undefined, eventCode: 1201, eventName: "lifePointCostPaid", eventPlayer: 0, eventReason: duelReason.cost, eventReasonCardUid: rat.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventValue: 700, relatedEffectId: undefined },
      { eventCardUid: defender.uid, eventCode: 1028, eventName: "becameTarget", eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventValue:  1, relatedEffectId: 2 },
    ]);
    expect(currentAttack(findCard(restoredOpen.session, defender.uid), restoredOpen.session.state)).toBe(500);
    expect(restoredOpen.session.state.effects.filter((effect) =>
      effect.sourceUid === defender.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: defender.uid, value: -700 },
    ]);
    expect(restoredOpen.session.state.flagEffects).toEqual([
      expect.objectContaining({ ownerType: "card", ownerId: rat.uid, code: Number(ratCode), reset: 1073741856, resetCount: 1 }),
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredStat);
    expect(currentAttack(findCard(restoredStat.session, defender.uid), restoredStat.session.state)).toBe(500);
    finishBattle(restoredStat);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 300 });
    expect(restoredStat.session.state.players[0].lifePoints).toBe(7300);
    expect(restoredStat.session.state.players[1].lifePoints).toBe(7700);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const rat = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === ratCode);
  expect(rat).toBeDefined();
  return [
    { ...rat!, kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: attackerCode, name: "Cornered Rat Level 2 Normal", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceBeast, attribute: attributeEarth, level: 2, attack: 800, defense: 800 },
    { code: defenderCode, name: "Cornered Rat Defender", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Attack of the Cornered Rat");
  expect(script).toContain("e2:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e2:SetHintTiming(TIMING_DAMAGE_STEP)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("phase~=PHASE_DAMAGE or Duel.IsDamageCalculated()");
  expect(script).toContain("a:IsFaceup() and a:IsLevelBelow(3) and a:IsType(TYPE_NORMAL) and a:IsRelateToBattle()");
  expect(script).toContain("Duel.IsPlayerAffectedByEffect(tp,EFFECT_LPCOST_CHANGE)");
  expect(script).toContain("Duel.CheckLPCost(tp,100)");
  expect(script).toContain("Duel.AnnounceNumber(tp,table.unpack(t))");
  expect(script).toContain("Duel.PayLPCost(tp,pay)");
  expect(script).toContain("Duel.SetTargetCard(tc)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.sequence = sequence;
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
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) =>
      candidate.type === "passAttack" || candidate.type === "passDamage" || candidate.type === "passChain"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
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

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) =>
      restored.session.state.chain.length > 0
        ? candidate.type === "passChain"
        : candidate.type === "passAttack" || candidate.type === "passDamage"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
}
