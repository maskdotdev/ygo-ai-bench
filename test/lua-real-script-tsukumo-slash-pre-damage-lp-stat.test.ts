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
const slashCode = "25334372";
const attackerCode = "253343720";
const targetCode = "253343721";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSlashScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${slashCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const effectUpdateAttack = 100;
const resetEventStandardDamageCalcPhase = 1107169344;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSlashScript)("Lua real script Tsukumo Slash pre-damage LP stat", () => {
  it("restores pre-damage activation into attacker ATK boost by absolute LP difference", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${slashCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredBattle({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const attacker = requireCard(restored.session, attackerCode);
    const target = requireCard(restored.session, targetCode);
    const attack = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === target.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, attack!);
    passBattleUntilSlash(restored);
    expect(restored.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredPreDamage);
    expectRestoredLegalActions(restoredPreDamage, 0);
    const slash = requireCard(restoredPreDamage.session, slashCode);
    const activate = getLuaRestoreLegalActions(restoredPreDamage, 0).find((action) =>
      action.type === "activateEffect" && action.uid === slash.uid && action.effectId === "lua-1-1134"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, activate!);
    resolveRestoredChain(restoredPreDamage);

    expect(restoredPreDamage.session.state.players[0].lifePoints).toBe(5000);
    expect(restoredPreDamage.session.state.players[1].lifePoints).toBe(8000);
    expect(currentAttack(findCard(restoredPreDamage.session, attacker.uid), restoredPreDamage.session.state)).toBe(4500);
    expect(restoredPreDamage.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { flags: resetEventStandardDamageCalcPhase }, sourceUid: attacker.uid, value: 3000 },
    ]);
    expect(restoredPreDamage.session.state.eventHistory.filter((event) => event.eventName === "beforeDamageCalculation").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
    }))).toEqual([
      { eventName: "beforeDamageCalculation", eventCardUid: attacker.uid, eventReason: 0, eventReasonPlayer: 0, eventUids: [attacker.uid, target.uid] },
    ]);
    expect(restoredPreDamage.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const slash = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === slashCode);
  expect(slash).toBeDefined();
  return [
    { ...slash!, kind: "spell" },
    { code: attackerCode, name: "Tsukumo Slash Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
    { code: targetCode, name: "Tsukumo Slash Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2200, defense: 1000 },
  ];
}

function createRestoredBattle({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 25334372, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [slashCode, attackerCode] }, 1: { main: [targetCode] } });
  startDuel(session);
  session.state.players[0].lifePoints = 5000;
  session.state.players[1].lifePoints = 8000;
  moveFaceDownSpellTrap(session, requireCard(session, slashCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, targetCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(slashCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Tsukumo Slash");
  expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("a:IsControler(tp) and a:GetAttack()<d:GetAttack() and Duel.GetLP(tp)~=Duel.GetLP(1-tp)");
  expect(script).toContain("local atk=math.abs(Duel.GetLP(tp)-Duel.GetLP(1-tp))");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_DAMAGE_CAL)");
  expect(script).toContain("e1:SetValue(atk)");
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

function passBattleUntilSlash(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.uid === requireCard(restored.session, slashCode).uid)) {
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
