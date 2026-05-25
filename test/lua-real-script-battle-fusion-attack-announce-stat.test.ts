import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const battleFusionCode = "43225434";
const fusionCode = "432254340";
const attackerCode = "432254341";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasBattleFusionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${battleFusionCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const effectUpdateAttack = 100;
const resetEventStandardDamagePhase = 1107169312;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasBattleFusionScript)("Lua real script Battle Fusion attack announce stat", () => {
  it("restores attack-announcement activation into Fusion monster ATK gain from its battle opponent", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${battleFusionCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredAttackResponse({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    const passOpponent = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passAttack");
    expect(passOpponent, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, passOpponent!);
    expectRestoredLegalActions(restored, 0);
    const battleFusion = requireCard(restored.session, battleFusionCode);
    const fusion = requireCard(restored.session, fusionCode);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === battleFusion.uid && action.effectId === "lua-1-1130"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(currentAttack(findCard(restored.session, fusion.uid), restored.session.state)).toBe(4600);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === fusion.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { flags: resetEventStandardDamagePhase }, sourceUid: fusion.uid, value: 2400 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "attackDeclared").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "attackDeclared", eventCardUid: fusion.uid, eventReason: 0, eventReasonPlayer: 0, previous: "extraDeck", current: "monsterZone" },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const battleFusion = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === battleFusionCode);
  expect(battleFusion).toBeDefined();
  return [
    { ...battleFusion!, kind: "spell" },
    { code: fusionCode, name: "Battle Fusion Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceWarrior, attribute: attributeEarth, level: 6, attack: 2200, defense: 1800 },
    { code: attackerCode, name: "Battle Fusion Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2400, defense: 1000 },
  ];
}

function createRestoredAttackResponse({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 43225434, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [battleFusionCode], extra: [fusionCode] }, 1: { main: [attackerCode] } });
  startDuel(session);
  moveFaceDownSpellTrap(session, requireCard(session, battleFusionCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, fusionCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(battleFusionCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const attack = getLegalActions(session, 0).find((action) =>
    action.type === "declareAttack" && action.attackerUid === requireCard(session, fusionCode).uid && action.targetUid === requireCard(session, attackerCode).uid
  );
  expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
  applyAndAssert(session, attack!);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Battle Fusion");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("a:IsControler(tp) and a:IsType(TYPE_FUSION)");
  expect(script).toContain("at:IsControler(tp) and at:IsFaceup() and at:IsType(TYPE_FUSION)");
  expect(script).toContain("if a:IsControler(1-tp) then a,at=at,a end");
  expect(script).toContain("a:IsRelateToBattle()");
  expect(script).toContain("at:IsRelateToBattle()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_DAMAGE)");
  expect(script).toContain("e1:SetValue(at:GetAttack())");
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
