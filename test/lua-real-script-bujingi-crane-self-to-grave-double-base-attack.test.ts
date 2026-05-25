import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const craneCode = "68601507";
const bujinDefenderCode = "686015070";
const attackerCode = "686015071";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasCraneScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${craneCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceBeastWarrior = 0x8000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x1;
const setBujin = 0x88;
const effectSetAttackFinal = 102;
const resetEventStandardPhaseDamageCalculation = 1107169344;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasCraneScript)("Lua real script Bujingi Crane self-to-grave double base attack", () => {
  it("restores pre-damage SelfToGrave into Bujin Beast-Warrior final ATK from doubled base ATK", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${craneCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredBattle({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    const crane = requireCard(restored.session, craneCode);
    const defender = requireCard(restored.session, bujinDefenderCode);
    const attacker = requireCard(restored.session, attackerCode);
    const attack = getLuaRestoreLegalActions(restored, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, attack!);
    passUntilDamageResponse(restored, 0);

    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === crane.uid && action.effectId === "lua-1-1134"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, crane.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: crane.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(findCard(restored.session, defender.uid), restored.session.state)).toBe(3200);
    expect(restored.session.state.effects.filter((effect) =>
      effect.sourceUid === defender.uid && effect.code === effectSetAttackFinal
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: resetEventStandardPhaseDamageCalculation }, sourceUid: defender.uid, value: 3200 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["attackDeclared", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { current: "monsterZone", eventCardUid: attacker.uid, eventCode: 1130, eventName: "attackDeclared", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "deck", relatedEffectId: undefined },
      { current: "graveyard", eventCardUid: crane.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost, eventReasonCardUid: crane.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "hand", relatedEffectId: undefined },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const crane = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === craneCode);
  expect(crane).toBeDefined();
  return [
    crane!,
    { code: bujinDefenderCode, name: "Bujingi Crane Bujin Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeLight, level: 4, attack: 1600, defense: 1000, setcodes: [setBujin] },
    { code: attackerCode, name: "Bujingi Crane Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2300, defense: 1600 },
  ];
}

function createRestoredBattle({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 68601507, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [craneCode, bujinDefenderCode] }, 1: { main: [attackerCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, craneCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, bujinDefenderCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(craneCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Bujingi Crane");
  expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("e1:SetCost(Cost.SelfToGrave)");
  expect(script).toContain("c:IsSetCard(SET_BUJIN) and c:IsRace(RACE_BEASTWARRIOR)");
  expect(script).toContain("not c:IsAttack(c:GetBaseAttack()*2)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_DAMAGE_CAL)");
  expect(script).toContain("e1:SetValue(c:GetBaseAttack()*2)");
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passUntilDamageResponse(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  let guard = 0;
  while (restored.session.state.waitingFor !== player || restored.session.state.battleWindow?.kind !== "beforeDamageCalculation") {
    expect(++guard).toBeLessThan(20);
    const actionPlayer = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, actionPlayer).find((action) => action.type === "passChain" || action.type === "passAttack" || action.type === "passDamage");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, actionPlayer), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
