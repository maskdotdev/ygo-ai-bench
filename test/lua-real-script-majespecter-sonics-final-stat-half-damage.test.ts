import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
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
const sonicsCode = "13611090";
const hasSonicsScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sonicsCode}.lua`));
const majespecterCode = "136110900";
const defenderCode = "136110901";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeQuickplay = 0x10000;
const setMajespecter = 0xd0;

describe.skipIf(!hasUpstreamScripts || !hasSonicsScript)("Lua real script Majespecter Sonics final stat half damage", () => {
  it("restores final ATK/DEF doubling plus target-scoped HALF_DAMAGE battle modifier", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${sonicsCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_MAJESPECTER)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(tc:GetAttack()*2)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e3:SetCode(EFFECT_CHANGE_BATTLE_DAMAGE)");
    expect(script).toContain("e3:SetValue(aux.ChangeBattleDamage(1,HALF_DAMAGE))");

    const cards: DuelCardData[] = [
      { code: sonicsCode, name: "Majespecter Sonics", kind: "spell", typeFlags: typeSpell | typeQuickplay, setcodes: [setMajespecter] },
      { code: majespecterCode, name: "Majespecter Fixture Attacker", kind: "monster", typeFlags: typeMonster, setcodes: [setMajespecter], level: 4, attack: 1000, defense: 800 },
      { code: defenderCode, name: "Majespecter Sonics Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 13611090, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sonicsCode, majespecterCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const sonics = requireCard(session, sonicsCode);
    const attacker = requireCard(session, majespecterCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, sonics.uid, "hand", 0);
    moveFaceUpAttack(session, attacker, 0);
    moveFaceUpAttack(session, defender, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sonicsCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    const opponentPass = getLegalActions(session, 1).find((action) => action.type === "passAttack");
    expect(opponentPass, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, opponentPass!);
    expect(session.state.battleWindow?.kind).toBe("attackNegationResponse");
    expect(currentAttack(attacker, session.state)).toBe(1000);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === sonics.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    expect(restoredActivation.session.state.cards.find((card) => card.uid === sonics.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredActivation.session.state.chain).toEqual([]);
    const restoredAttacker = restoredActivation.session.state.cards.find((card) => card.uid === attacker.uid)!;
    expect(currentAttack(restoredAttacker, restoredActivation.session.state)).toBe(2000);
    expect(currentDefense(restoredAttacker, restoredActivation.session.state)).toBe(1600);
    expect(restoredActivation.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid).map((effect) => ({
      code: effect.code,
      registryKey: effect.registryKey,
      value: effect.value,
    }))).toEqual([
      { code: 102, registryKey: "lua:13611090:lua-2-102", value: 2000 },
      { code: 106, registryKey: "lua:13611090:lua-3-106", value: 1600 },
      { code: 208, registryKey: "lua:13611090:lua-4-208", value: undefined },
    ]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    const boostedAttacker = restoredBoost.session.state.cards.find((card) => card.uid === attacker.uid)!;
    expect(currentAttack(boostedAttacker, restoredBoost.session.state)).toBe(2000);
    expect(currentDefense(boostedAttacker, restoredBoost.session.state)).toBe(1600);
    expect(restoredBoost.session.state.effects.find((effect) => effect.registryKey === "lua:13611090:lua-4-208")).toMatchObject({
      code: 208,
      registryKey: "lua:13611090:lua-4-208",
      sourceUid: attacker.uid,
    });

    passRestoredBattleResponses(restoredBoost);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 250 });
    expect(restoredBoost.session.state.players[0]!.lifePoints).toBe(8000);
    expect(restoredBoost.session.state.players[1]!.lifePoints).toBe(7750);
    expect(restoredBoost.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredBoost.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: attacker.uid,
        eventPlayer: 1,
        eventValue: 250,
        eventReason: duelReason.battle,
        eventReasonPlayer: 0,
        eventReasonCardUid: attacker.uid,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
