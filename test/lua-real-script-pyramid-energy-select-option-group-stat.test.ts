import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const pyramidCode = "76754619";
const firstCode = "767546190";
const secondCode = "767546191";
const opponentCode = "767546192";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasPyramidScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${pyramidCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPyramidScript)("Lua real script Pyramid Energy SelectOption group stat", () => {
  it("restores SelectOption ATK and DEF branches over every own face-up monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${pyramidCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const attackBranch = createRestoredBattle({ reader, workspace, option: 0 });
    activateAndResolve(attackBranch);
    const attackFirst = requireCard(attackBranch.session, firstCode);
    const attackSecond = requireCard(attackBranch.session, secondCode);
    const attackOpponent = requireCard(attackBranch.session, opponentCode);
    expect(selectOptionDecisions(attackBranch)).toEqual([{ api: "SelectOption", descriptions: [1228073904, 1228073905], options: [0, 1], player: 0, returned: 0 }]);
    expect(currentAttack(findCard(attackBranch.session, attackFirst.uid), attackBranch.session.state)).toBe(1600);
    expect(currentAttack(findCard(attackBranch.session, attackSecond.uid), attackBranch.session.state)).toBe(1100);
    expect(currentAttack(findCard(attackBranch.session, attackOpponent.uid), attackBranch.session.state)).toBe(2200);
    expect(attackBranch.session.state.effects.filter((effect) =>
      [attackFirst.uid, attackSecond.uid, attackOpponent.uid].includes(effect.sourceUid ?? "") && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: attackFirst.uid, value: 200 },
      { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: attackSecond.uid, value: 200 },
    ]);
    expect(attackBranch.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const defenseBranch = createRestoredBattle({ reader, workspace, option: 1 });
    activateAndResolve(defenseBranch);
    const defenseFirst = requireCard(defenseBranch.session, firstCode);
    const defenseSecond = requireCard(defenseBranch.session, secondCode);
    const defenseOpponent = requireCard(defenseBranch.session, opponentCode);
    expect(selectOptionDecisions(defenseBranch)).toEqual([{ api: "SelectOption", descriptions: [1228073904, 1228073905], options: [0, 1], player: 0, returned: 1 }]);
    expect(currentDefense(findCard(defenseBranch.session, defenseFirst.uid), defenseBranch.session.state)).toBe(1500);
    expect(currentDefense(findCard(defenseBranch.session, defenseSecond.uid), defenseBranch.session.state)).toBe(1400);
    expect(currentDefense(findCard(defenseBranch.session, defenseOpponent.uid), defenseBranch.session.state)).toBe(1800);
    expect(defenseBranch.session.state.effects.filter((effect) =>
      [defenseFirst.uid, defenseSecond.uid, defenseOpponent.uid].includes(effect.sourceUid ?? "") && effect.code === effectUpdateDefense
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateDefense, reset: { flags: resetStandardPhaseEnd }, sourceUid: defenseFirst.uid, value: 500 },
      { code: effectUpdateDefense, reset: { flags: resetStandardPhaseEnd }, sourceUid: defenseSecond.uid, value: 500 },
    ]);
    expect(defenseBranch.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const pyramid = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === pyramidCode);
  expect(pyramid).toBeDefined();
  return [
    { ...pyramid!, kind: "trap", typeFlags: typeTrap },
    { code: firstCode, name: "Pyramid Energy First", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1400, defense: 1000 },
    { code: secondCode, name: "Pyramid Energy Second", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 900, defense: 900 },
    { code: opponentCode, name: "Pyramid Energy Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2200, defense: 1800 },
  ];
}

function createRestoredBattle({
  reader,
  workspace,
  option,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  option: 0 | 1;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 76754619 + option, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [pyramidCode, firstCode, secondCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  moveFaceDownSpellTrap(session, requireCard(session, pyramidCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, firstCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, secondCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace, { promptOverrides: [{ api: "SelectOption", player: 0, returned: option }] });
  expect(host.loadCardScript(Number(pyramidCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides: [{ api: "SelectOption", player: 0, returned: option }] });
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 1);
  const attacker = requireCard(restored.session, opponentCode);
  const defender = requireCard(restored.session, firstCode);
  const attack = getLuaRestoreLegalActions(restored, 1).find((action) =>
    action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid
  );
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, attack!);
  passBattleUntilPyramid(restored);
  const restoredDamage = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader, { promptOverrides: [{ api: "SelectOption", player: 0, returned: option }] });
  expectCleanRestore(restoredDamage);
  expectRestoredLegalActions(restoredDamage, 0);
  return restoredDamage;
}

function activateAndResolve(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const pyramid = requireCard(restored.session, pyramidCode);
  const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
    action.type === "activateEffect" && action.uid === pyramid.uid && action.effectId === "lua-1-1002"
  );
  expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, activate!);
  resolveRestoredChain(restored);
}

function selectOptionDecisions(restored: ReturnType<typeof restoreDuelWithLuaScripts>): Array<{
  api: "SelectOption";
  descriptions: number[];
  options: number[];
  player: PlayerId | undefined;
  returned: number;
}> {
  return restored.host.promptDecisions.flatMap((prompt) => prompt.api === "SelectOption" ? [{
    api: prompt.api,
    descriptions: prompt.descriptions,
    options: prompt.options,
    player: prompt.player,
    returned: prompt.returned,
  }] : []);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Pyramid Energy");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetHintTiming(TIMING_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsFaceup,tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("Duel.SelectOption(tp,aux.Stringid(id,0),aux.Stringid(id,1))");
  expect(script).toContain("e:SetLabel(op)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("for sc in aux.Next(g) do");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(200)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("e1:SetValue(500)");
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

function passBattleUntilPyramid(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.uid === requireCard(restored.session, pyramidCode).uid)) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
