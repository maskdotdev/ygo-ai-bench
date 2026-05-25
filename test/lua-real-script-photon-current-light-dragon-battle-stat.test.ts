import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const currentCode = "43813459";
const attackerCode = "438134590";
const lightDragonCode = "438134591";
const darkDragonDecoyCode = "438134592";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasCurrentScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${currentCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const attributeDark = 0x20;
const attributeLight = 0x10;
const effectUpdateAttack = 100;
const resetEventStandardDamagePhase = 1107169312;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasCurrentScript)("Lua real script Photon Current LIGHT Dragon battle stat", () => {
  it("restores LIGHT Dragon battle-target trap into attacker ATK gain through damage phase", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${currentCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const { restored, photonCurrent, attacker, lightDragon, darkDragonDecoy } = createRestoredBattleTarget({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === photonCurrent.uid && action.effectId === "lua-1-1131"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(currentAttack(findCard(restored.session, attacker.uid), restored.session.state)).toBe(2400);
    expect(currentAttack(findCard(restored.session, lightDragon.uid), restored.session.state)).toBe(4200);
    expect(currentAttack(findCard(restored.session, darkDragonDecoy.uid), restored.session.state)).toBe(1700);
    expect(restored.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetEventStandardDamagePhase }, sourceUid: lightDragon.uid, value: 2400 },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const photonCurrent = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === currentCode);
  expect(photonCurrent).toBeDefined();
  return [
    { ...photonCurrent!, kind: "trap", typeFlags: typeTrap },
    { code: attackerCode, name: "Photon Current Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 2400, defense: 1000 },
    { code: lightDragonCode, name: "Photon Current LIGHT Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 4, attack: 1800, defense: 1000 },
    { code: darkDragonDecoyCode, name: "Photon Current DARK Dragon Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
  ];
}

function createRestoredBattleTarget({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): {
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
  photonCurrent: DuelCardInstance;
  attacker: DuelCardInstance;
  lightDragon: DuelCardInstance;
  darkDragonDecoy: DuelCardInstance;
} {
  const session = createDuel({ seed: 43813459, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [currentCode, lightDragonCode, darkDragonDecoyCode] }, 1: { main: [attackerCode] } });
  startDuel(session);
  const photonCurrent = requireCard(session, currentCode);
  const attacker = requireCard(session, attackerCode);
  const lightDragon = requireCard(session, lightDragonCode);
  const darkDragonDecoy = requireCard(session, darkDragonDecoyCode);
  moveFaceDownSpellTrap(session, photonCurrent, 0, 0);
  moveFaceUpAttack(session, lightDragon, 0, 0);
  moveFaceUpAttack(session, darkDragonDecoy, 0, 1);
  moveFaceUpAttack(session, attacker, 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(currentCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restoredOpen);
  expectRestoredLegalActions(restoredOpen, 1);
  const attack = getLuaRestoreLegalActions(restoredOpen, 1).find((action) =>
    action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === lightDragon.uid
  );
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredOpen, attack!);
  expect(restoredOpen.session.state.pendingBattle).toMatchObject({ attackerUid: attacker.uid, targetUid: lightDragon.uid });
  return { restored: restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader), photonCurrent, attacker, lightDragon, darkDragonDecoy };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Photon Current");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_BE_BATTLE_TARGET)");
  expect(script).toContain("d:IsFaceup() and d:IsControler(tp) and d:IsAttribute(ATTRIBUTE_LIGHT) and d:IsRace(RACE_DRAGON)");
  expect(script).toContain("Duel.GetAttacker():CreateEffectRelation(e)");
  expect(script).toContain("Duel.GetAttackTarget():CreateEffectRelation(e)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(a:GetAttack())");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_DAMAGE)");
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
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
