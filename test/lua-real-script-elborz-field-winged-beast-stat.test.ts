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
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const elborzCode = "92223430";
const attackerCode = "922234300";
const nonWindAllyCode = "922234301";
const defenderCode = "922234302";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasElborzScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${elborzCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWingedBeast = 0x200;
const attributeWind = 0x8;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasElborzScript)("Lua real script Elborz Field Winged Beast stat", () => {
  it("restores Field Zone WIND Winged Beast ATK/DEF updates into battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${elborzCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createBattleSession({ reader, workspace });
    const elborz = requireCard(session, elborzCode);
    const attacker = requireCard(session, attackerCode);
    const nonWindAlly = requireCard(session, nonWindAllyCode);
    const defender = requireCard(session, defenderCode);

    expect(session.state.effects.filter((effect) => effect.sourceUid === elborz.uid && (effect.code === effectUpdateAttack || effect.code === effectUpdateDefense)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      {
        code: effectUpdateAttack,
        event: "continuous",
        luaTargetDescriptor: "target:attribute-race:8:512",
        range: ["spellTrapZone"],
        sourceUid: elborz.uid,
        targetRange: [4, 4],
        value: 300,
      },
      {
        code: effectUpdateDefense,
        event: "continuous",
        luaTargetDescriptor: "target:attribute-race:8:512",
        range: ["spellTrapZone"],
        sourceUid: elborz.uid,
        targetRange: [4, 4],
        value: 300,
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(currentAttack(findCard(restored.session, attacker.uid), restored.session.state)).toBe(1500);
    expect(currentDefense(findCard(restored.session, attacker.uid), restored.session.state)).toBe(1300);
    expect(currentAttack(findCard(restored.session, nonWindAlly.uid), restored.session.state)).toBe(1100);
    expect(currentDefense(findCard(restored.session, nonWindAlly.uid), restored.session.state)).toBe(1000);
    expect(currentAttack(findCard(restored.session, defender.uid), restored.session.state)).toBe(1000);

    const attack = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyAndAssert(restored.session, attack!);
    passBattleResponses(restored.session);

    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 500 });
    expect(restored.session.state.players[1].lifePoints).toBe(7500);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: attacker.uid,
        eventPlayer: 1,
        eventValue: 500,
        eventReason: duelReason.battle,
        eventReasonCardUid: attacker.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restored.session.state.pendingTriggers).toEqual([]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === elborzCode),
    { code: attackerCode, name: "Elborz WIND Winged Beast Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeWind, level: 4, attack: 1200, defense: 1000 },
    { code: nonWindAllyCode, name: "Elborz Earth Winged Beast Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeEarth, level: 4, attack: 1100, defense: 1000 },
    { code: defenderCode, name: "Elborz Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createBattleSession({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): DuelSession {
  const session = createDuel({ seed: 92223430, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [elborzCode, attackerCode, nonWindAllyCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, elborzCode).uid, "spellTrapZone", 0).faceUp = true;
  moveFaceUpAttack(session, requireCard(session, attackerCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, nonWindAllyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(elborzCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Elborz, the Sacred Lands of Simorgh");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetRange(LOCATION_FZONE)");
  expect(script).toContain("e2:SetTargetRange(LOCATION_MZONE,LOCATION_MZONE)");
  expect(script).toContain("e2:SetTarget(aux.TargetBoolFunction(s.filter))");
  expect(script).toContain("e2:SetValue(300)");
  expect(script).toContain("e3=e2:Clone()");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("return c:IsAttribute(ATTRIBUTE_WIND) and c:IsRace(RACE_WINGEDBEAST)");
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
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
