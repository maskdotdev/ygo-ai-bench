import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const alienSkullCode = "25920413";
const opponentReleaseCode = "259204130";
const alienBattleTargetCode = "259204131";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAlienSkullScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${alienSkullCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceReptile = 0x80000;
const attributeDark = 0x20;
const setAlien = 0xc;
const counterA = 0x100e;
const luaSummonTypeSpecial = 0x40000000;

describe.skipIf(!hasUpstreamScripts || !hasAlienSkullScript)("Lua real script Alien Skull Lava counter stat", () => {
  it("restores Lava procedure, custom summon A-Counter trigger, summon lock cost, and battle stat metadata", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectAlienSkullScriptShape(workspace.readScript(`official/c${alienSkullCode}.lua`));
    const reader = createCardReader(cards());
    const session = setupDuel(reader);
    const alienSkull = requireCard(session, alienSkullCode);
    const alienBattleTarget = requireCard(session, alienBattleTargetCode);
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(alienSkullCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === alienSkull.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: 34, event: "summonProcedure", id: "lua-1-34", property: 1310720, range: ["hand"], targetRange: [5, 1] },
      { code: 1102, event: "continuous", id: "lua-2-1102", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined },
      { code: 100, event: "continuous", id: "lua-3-100", property: undefined, range: ["monsterZone"], targetRange: [4, 4] },
      { code: 104, event: "continuous", id: "lua-4-104", property: undefined, range: ["monsterZone"], targetRange: [4, 4] },
      { code: 92, event: "continuous", id: "lua-5-92", property: 1024, range: ["hand"], targetRange: undefined },
    ]);

    const restoredCost = restoredOpen.session.state.effects.find((effect) => effect.sourceUid === alienSkull.uid && effect.code === 92)?.cost;
    expect(restoredCost?.({ summonTypeCode: luaSummonTypeSpecial + 1, checkOnly: true } as never)).toBe(false);
    expect(restoredCost?.({ summonTypeCode: luaSummonTypeSpecial + 2, checkOnly: true } as never)).toBe(true);
    expect(getLuaRestoreLegalActions(restoredOpen, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === alienSkull.uid)).toBe(false);

    const movedSkull = moveFaceUpAttack(restoredOpen.session, findCard(restoredOpen.session, alienSkull.uid), 1, 0);
    movedSkull.summonType = "special";
    movedSkull.summonTypeCode = luaSummonTypeSpecial + 1;
    expect(addDuelCardCounter(movedSkull, counterA, 1)).toBe(true);
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 1;
    restoredBattle.session.state.waitingFor = 1;
    restoredBattle.session.state.currentAttack = { attackerUid: alienSkull.uid, targetUid: alienBattleTarget.uid };
    restoredBattle.session.state.pendingBattle = { attackerUid: alienSkull.uid, targetUid: alienBattleTarget.uid };
    restoredBattle.session.state.battleStep = "damageCalculation";

    expect(currentAttack(findCard(restoredBattle.session, alienSkull.uid), restoredBattle.session.state)).toBe(1300);
    expect(currentDefense(findCard(restoredBattle.session, alienSkull.uid), restoredBattle.session.state)).toBe(500);
    expect(currentAttack(findCard(restoredBattle.session, alienBattleTarget.uid), restoredBattle.session.state)).toBe(1600);
    expect(currentDefense(findCard(restoredBattle.session, alienBattleTarget.uid), restoredBattle.session.state)).toBe(1200);
  });
});

function setupDuel(reader: ReturnType<typeof createCardReader>): DuelSession {
  const session = createDuel({ seed: 25920413, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [alienSkullCode, opponentReleaseCode, alienBattleTargetCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, alienSkullCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, opponentReleaseCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, alienBattleTargetCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function expectAlienSkullScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Alien Skull");
  expect(script).toContain("aux.AddLavaProcedure(c,1,POS_FACEUP,aux.AND(Card.IsFaceup,aux.FilterBoolFunction(Card.IsLevelBelow,3)),1)");
  expect(script).toContain("s.counter_place_list={COUNTER_A}");
  expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():GetSummonType()==SUMMON_TYPE_SPECIAL+1");
  expect(script).toContain("c:AddCounter(COUNTER_NEED_ENABLE+COUNTER_A,1)");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e4:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("return Duel.IsPhase(PHASE_DAMAGE_CAL) and Duel.GetAttackTarget()");
  expect(script).toContain("return bc and c:GetCounter(COUNTER_A)~=0 and bc:IsSetCard(SET_ALIEN)");
  expect(script).toContain("return c:GetCounter(COUNTER_A)*-300");
  expect(script).toContain("e5:SetCode(EFFECT_SPSUMMON_COST)");
  expect(script).toContain("return sumtype ~= SUMMON_TYPE_SPECIAL+1 or Duel.GetActivityCount(tp,ACTIVITY_NORMALSUMMON)==0");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SUMMON)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_MSET)");
}

function cards(): DuelCardData[] {
  return [
    { code: alienSkullCode, name: "Alien Skull", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setAlien], race: raceReptile, attribute: attributeDark, level: 4, attack: 1600, defense: 800 },
    { code: opponentReleaseCode, name: "Alien Skull Opponent Release", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, level: 3, attack: 900, defense: 700 },
    { code: alienBattleTargetCode, name: "Alien Skull Battle Alien", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setAlien], race: raceReptile, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
  ];
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
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
