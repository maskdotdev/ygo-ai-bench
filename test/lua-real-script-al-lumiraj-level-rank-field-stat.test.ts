import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeXyzMonster = 0x800001;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Al-Lumi'raj Level or Rank field stat", () => {
  it("restores callback-valued Level or Rank ATK/DEF loss into battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const alLumirajCode = "25795273";
    const levelAttackerCode = "257952731";
    const levelDefenderCode = "257952732";
    const rankTargetCode = "257952733";
    const script = workspace.readScript(`c${alLumirajCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e1:SetTargetRange(LOCATION_MZONE,LOCATION_MZONE)");
    expect(script).toContain("e1:SetValue(s.val)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("if c:IsType(TYPE_XYZ) then return c:GetRank()*-300");
    expect(script).toContain("return c:GetLevel()*-300");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === alLumirajCode),
      { code: levelAttackerCode, name: "Al-Lumi'raj Level 4 Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2500, defense: 2500 },
      { code: levelDefenderCode, name: "Al-Lumi'raj Level 2 Defender", kind: "monster", typeFlags: typeMonster, level: 2, attack: 1600, defense: 1600 },
      { code: rankTargetCode, name: "Al-Lumi'raj Rank 4 Xyz Target", kind: "extra", typeFlags: typeXyzMonster, level: 4, attack: 2500, defense: 2500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2579, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [alLumirajCode, levelAttackerCode] }, 1: { main: [levelDefenderCode, rankTargetCode] } });
    startDuel(session);

    const alLumiraj = session.state.cards.find((card) => card.code === alLumirajCode);
    const levelAttacker = session.state.cards.find((card) => card.code === levelAttackerCode);
    const levelDefender = session.state.cards.find((card) => card.code === levelDefenderCode);
    const rankTarget = session.state.cards.find((card) => card.code === rankTargetCode);
    expect(alLumiraj).toBeDefined();
    expect(levelAttacker).toBeDefined();
    expect(levelDefender).toBeDefined();
    expect(rankTarget).toBeDefined();
    moveDuelCard(session.state, alLumiraj!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, levelAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, levelDefender!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, rankTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(alLumirajCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === alLumiraj!.uid && (effect.code === 100 || effect.code === 104)).map((effect) => ({
      code: effect.code,
      id: effect.id,
      luaValueDescriptor: effect.luaValueDescriptor,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      {
        code: 100,
        id: "lua-1-100",
        luaValueDescriptor: "stat:level-or-rank:x-300",
        range: ["monsterZone"],
        sourceUid: alLumiraj!.uid,
        targetRange: [4, 4],
        value: undefined,
      },
      {
        code: 104,
        id: "lua-2-104",
        luaValueDescriptor: "stat:level-or-rank:x-300",
        range: ["monsterZone"],
        sourceUid: alLumiraj!.uid,
        targetRange: [4, 4],
        value: undefined,
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const restoredLevelAttacker = restored.session.state.cards.find((card) => card.uid === levelAttacker!.uid)!;
    const restoredLevelDefender = restored.session.state.cards.find((card) => card.uid === levelDefender!.uid)!;
    const restoredRankTarget = restored.session.state.cards.find((card) => card.uid === rankTarget!.uid)!;
    expect(currentAttack(restoredLevelAttacker, restored.session.state)).toBe(1300);
    expect(currentDefense(restoredLevelAttacker, restored.session.state)).toBe(1300);
    expect(currentAttack(restoredLevelDefender, restored.session.state)).toBe(1000);
    expect(currentDefense(restoredLevelDefender, restored.session.state)).toBe(1000);
    expect(currentAttack(restoredRankTarget, restored.session.state)).toBe(1300);
    expect(currentDefense(restoredRankTarget, restored.session.state)).toBe(1300);

    const attack = getLuaRestoreLegalActions(restored, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === levelAttacker!.uid && action.targetUid === levelDefender!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyAndAssert(restored.session, attack!);
    passBattleResponses(restored.session);

    expect(restored.session.state.battleDamage[1]).toBe(300);
    expect(restored.session.state.players[1].lifePoints).toBe(7700);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: levelAttacker!.uid,
        eventPlayer: 1,
        eventValue: 300,
        eventReason: duelReason.battle,
        eventReasonCardUid: levelAttacker!.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === levelDefender!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === levelAttacker!.uid)).toMatchObject({ location: "monsterZone" });
  });
});

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function passBattleResponses(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
