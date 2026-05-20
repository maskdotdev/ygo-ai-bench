import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const taiStrikeCode = "86449372";
const hasTaiStrikeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${taiStrikeCode}.lua`));
const aiMonsterCode = "864493720";
const opponentMonsterCode = "864493721";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeQuickPlay = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasTaiStrikeScript)("Lua real script TA.I. Strike pre-damage step-end burn", () => {
  it("restores pre-damage final ATK matching and Damage Step end battle-destroyed burn", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${taiStrikeCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DAMAGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(bc:GetAttack())");
    expect(script).toContain("e2:SetCode(EVENT_DAMAGE_STEP_END)");
    expect(script).toContain("Duel.RegisterEffect(e2,tp)");
    expect(script).toContain("if c:GetReason()&0x21==0x21 then");
    expect(script).toContain("Duel.Damage(c:GetPreviousControler(),c:GetBaseAttack(),REASON_EFFECT)");
    expect(script).toContain("s.damage(Duel.GetAttacker())");
    expect(script).toContain("s.damage(Duel.GetAttackTarget())");

    const cards: DuelCardData[] = [
      { code: taiStrikeCode, name: "TA.I. Strike", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
      { code: aiMonsterCode, name: "TA.I. Strike @Ignister Monster", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [0x135], level: 4, attack: 1000, defense: 1000 },
      { code: opponentMonsterCode, name: "TA.I. Strike Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2500, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 86449372, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [taiStrikeCode, aiMonsterCode] }, 1: { main: [opponentMonsterCode] } });
    startDuel(session);

    const taiStrike = requireCard(session, taiStrikeCode);
    const aiMonster = requireCard(session, aiMonsterCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    moveDuelCard(session.state, taiStrike.uid, "spellTrapZone", 0);
    taiStrike.position = "faceDown";
    taiStrike.faceUp = false;
    moveDuelCard(session.state, aiMonster.uid, "monsterZone", 0).position = "faceUpAttack";
    aiMonster.faceUp = true;
    moveDuelCard(session.state, opponentMonster.uid, "monsterZone", 1).position = "faceUpAttack";
    opponentMonster.faceUp = true;
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(taiStrikeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === aiMonster.uid && action.targetUid === opponentMonster.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleAction(session, 1, "passAttack");
    passBattleAction(session, 0, "passAttack");
    passBattleAction(session, 1, "passDamage");
    passBattleAction(session, 0, "passDamage");
    expect(session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    passBattleAction(session, 1, "passDamage");
    expect(session.state.waitingFor).toBe(0);

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredPreDamage);
    expectRestoredLegalActions(restoredPreDamage, 0);
    const activation = getLuaRestoreLegalActions(restoredPreDamage, 0).find((action) => action.type === "activateEffect" && action.uid === taiStrike.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPreDamage, activation!);
    expect(restoredPreDamage.session.state.chain.flatMap((link) => link.operationInfos)).toEqual([]);
    expect(currentAttack(restoredPreDamage.session.state.cards.find((card) => card.uid === aiMonster.uid), restoredPreDamage.session.state)).toBe(2500);
    expect(restoredPreDamage.session.state.effects.filter((effect) => effect.sourceUid === aiMonster.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 102, event: "continuous", reset: { flags: 1107169344 }, value: 2500 },
    ]);
    expect(restoredPreDamage.session.state.effects.filter((effect) => effect.sourceUid === taiStrike.uid && effect.event === "continuous").map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 50, event: "continuous", reset: undefined, value: undefined },
      { code: 1141, event: "continuous", reset: { flags: 1073741856 }, value: undefined },
    ]);

    const restoredDamageStep = restoreDuelWithLuaScripts(serializeDuel(restoredPreDamage.session), workspace, reader);
    expectCleanRestore(restoredDamageStep);
    expectRestoredLegalActions(restoredDamageStep, 1);
    passRestoredBattle(restoredDamageStep);
    expect(restoredDamageStep.session.state.players[0].lifePoints).toBe(7000);
    expect(restoredDamageStep.session.state.players[1].lifePoints).toBe(5500);
    expect(restoredDamageStep.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredDamageStep.session.state.cards.find((card) => card.uid === aiMonster.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredDamageStep.session.state.cards.find((card) => card.uid === opponentMonster.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: aiMonster.uid,
    });
    expect(restoredDamageStep.session.state.eventHistory.filter((event) => ["battleDestroyed", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: taiStrike.uid,
        eventReasonEffectId: 4,
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 2500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: taiStrike.uid,
        eventReasonEffectId: 4,
      },
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: opponentMonster.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: aiMonster.uid,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function passBattleAction(session: DuelSession, player: PlayerId, type: "passAttack" | "passDamage"): void {
  const pass = getLegalActions(session, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
  applyAndAssert(session, pass!);
}

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    if (restored.session.state.chain.length > 0) {
      const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
      expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restored, pass!);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
