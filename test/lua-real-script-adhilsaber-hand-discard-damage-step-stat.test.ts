import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const adhilsaberCode = "61151074";
const hasAdhilsaberScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${adhilsaberCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setSkyStriker = 0x115;

describe.skipIf(!hasUpstreamScripts || !hasAdhilsaberScript)("Lua real script Sky Striker Mecha - Adhilsaber hand Damage Step stat", () => {
  it("restores the hand discard cost, target info, and Damage Step ATK update", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const attackerCode = "61151075";
    const targetCode = "61151076";
    const defenderCode = "61151077";
    const script = workspace.readScript(`official/c${adhilsaberCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetRange(LOCATION_HAND)");
    expect(script).toContain("Duel.IsBattlePhase() and aux.StatChangeDamageStepCondition()");
    expect(script).toContain("e1:SetCost(Cost.SelfDiscard)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsSetCard,SET_SKY_STRIKER),tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g,1,tp,1500)");
    expect(script).toContain("tc:UpdateAttack(1500,RESETS_STANDARD_PHASE_END,e:GetHandler())");

    const cards: DuelCardData[] = [
      { code: adhilsaberCode, name: "Sky Striker Mecha - Adhilsaber", kind: "monster", typeFlags: typeMonster | typeEffect, level: 7, attack: 1500, defense: 1500, setcodes: [setSkyStriker] },
      { code: attackerCode, name: "Adhilsaber Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200 },
      { code: targetCode, name: "Sky Striker Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1000, setcodes: [setSkyStriker] },
      { code: defenderCode, name: "Adhilsaber Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 61151074, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [adhilsaberCode, attackerCode, targetCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const adhilsaber = requireCard(session, adhilsaberCode);
    const attacker = requireCard(session, attackerCode);
    const target = requireCard(session, targetCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, adhilsaber.uid, "hand", 0);
    moveFaceUpAttack(session, attacker.uid, 0);
    moveFaceUpAttack(session, target.uid, 0);
    moveFaceUpAttack(session, defender.uid, 1);
    session.state.turnPlayer = 0;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(adhilsaberCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === adhilsaber.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      {
        category: 0x200000,
        code: 1002,
        event: "quick",
        id: "lua-1-1002",
        property: 0x4010,
        range: ["hand"],
        sourceUid: adhilsaber.uid,
      },
      {
        category: 0x240000,
        code: 1102,
        event: "trigger",
        id: "lua-2-1102",
        property: 0x10010,
        range: ["graveyard"],
        sourceUid: adhilsaber.uid,
      },
    ]);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleAction(session, 1, "passAttack");
    passBattleAction(session, 0, "passAttack");
    expect(session.state.battleWindow?.kind).toBe("startDamageStep");
    passBattleAction(session, 1, "passDamage");
    expect(session.state.battleWindow).toMatchObject({ kind: "startDamageStep", step: "damage", responsePlayer: 0 });
    expect(currentAttack(target, session.state)).toBe(1400);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const action = getLuaRestoreLegalActions(restoredActivation, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === adhilsaber.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    expect(action).toMatchObject({
      effectId: "lua-1-1002",
      windowKind: "battle",
    });
    applyRestoredActionAndAssert(restoredActivation, action!);
    expect(restoredActivation.session.state.cards.find((card) => card.uid === adhilsaber.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: adhilsaber.uid,
    });
    expect(restoredActivation.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === adhilsaber.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: adhilsaber.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: adhilsaber.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restoredActivation.session.state.chain).toHaveLength(0);
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === target.uid), restoredActivation.session.state)).toBe(2900);
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === attacker.uid), restoredActivation.session.state)).toBe(1600);
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === defender.uid), restoredActivation.session.state)).toBe(2000);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === target.uid), restoredBoost.session.state)).toBe(2900);
    passRestoredBattleResponses(restoredBoost);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 400, 1: 0 });
    expect(restoredBoost.session.state.players[0].lifePoints).toBe(7600);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: defender.uid,
        eventPlayer: 0,
        eventReason: duelReason.battle,
        eventReasonCardUid: defender.uid,
        eventReasonPlayer: 1,
        eventValue: 400,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, uid: string, player: PlayerId): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function passBattleAction(session: DuelSession, player: PlayerId, type: "passAttack" | "passDamage"): void {
  const action = getLegalActions(session, player).find((candidate) => candidate.type === type);
  expect(action, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
  applyAndAssert(session, action!);
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    if (restored.session.state.chain.length > 0) {
      passRestoredChain(restored, player);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
  const player = response.state.waitingFor;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
