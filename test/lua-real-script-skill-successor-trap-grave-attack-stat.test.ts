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
const skillCode = "73729209";
const targetCode = "737292090";
const graveTargetCode = "737292091";
const defenderCode = "737292092";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSkillScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${skillCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSkillScript)("Lua real script Skill Successor trap grave attack stat", () => {
  it("restores trap +400 and later aux.exccon grave self-banish +800 ATK boosts", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${skillCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const trap = createRestoredTrapField({ reader, workspace });
    expectCleanRestore(trap);
    expectRestoredLegalActions(trap, 0);
    const trapSkill = requireCard(trap.session, skillCode);
    const target = requireCard(trap.session, targetCode);
    const activate = getLuaRestoreLegalActions(trap, 0).find((action) =>
      action.type === "activateEffect" && action.uid === trapSkill.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(trap, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(trap, activate!);
    resolveRestoredChain(trap);
    expect(currentAttack(findCard(trap.session, target.uid), trap.session.state)).toBe(1900);
    expect(trap.session.state.effects.filter((effect) =>
      effect.sourceUid === target.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: target.uid, value: 400 },
    ]);
    expect(trap.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 1 },
    ]);

    const grave = createRestoredGraveField({ reader, workspace });
    expectCleanRestore(grave);
    expectRestoredLegalActions(grave, 0);
    const graveSkill = requireCard(grave.session, skillCode);
    const graveTarget = requireCard(grave.session, graveTargetCode);
    const defender = requireCard(grave.session, defenderCode);
    const attack = getLuaRestoreLegalActions(grave, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === graveTarget.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(grave, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(grave, attack!);
    passUntilBattleWindow(grave, "beforeDamageCalculation");
    if (grave.session.state.waitingFor === 1) {
      const opponentPass = getLuaRestoreLegalActions(grave, 1).find((action) => action.type === "passDamage");
      expect(opponentPass, JSON.stringify(getLuaRestoreLegalActions(grave, 1), null, 2)).toBeDefined();
      applyRestoredActionAndAssert(grave, opponentPass!);
    }
    const boost = getLuaRestoreLegalActions(grave, 0).find((action) =>
      action.type === "activateEffect" && action.uid === graveSkill.uid && action.effectId === "lua-2-1002"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(grave, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(grave, boost!);
    resolveRestoredChain(grave);
    expect(findCard(grave.session, graveSkill.uid)).toMatchObject({
      controller: 0,
      faceUp: true,
      location: "banished",
      reason: duelReason.cost,
      reasonCardUid: graveSkill.uid,
      reasonEffectId: 2,
      reasonPlayer: 0,
    });
    expect(currentAttack(findCard(grave.session, graveTarget.uid), grave.session.state)).toBe(2400);
    expect(grave.session.state.effects.filter((effect) =>
      effect.sourceUid === graveTarget.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: graveTarget.uid, value: 800 },
    ]);
    expect(grave.session.state.eventHistory.filter((event) => ["banished", "becameTarget"].includes(event.eventName)).map((event) => ({
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
      { current: "banished", eventCardUid: graveSkill.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: graveSkill.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "graveyard", relatedEffectId: undefined },
      { current: "monsterZone", eventCardUid: graveTarget.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", relatedEffectId: 2 },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(grave.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expect(currentAttack(findCard(restoredStat.session, graveTarget.uid), restoredStat.session.state)).toBe(2400);
    finishBattle(restoredStat);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 500 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const skill = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === skillCode);
  expect(skill).toBeDefined();
  return [
    { ...skill!, kind: "trap", typeFlags: typeTrap },
    { code: targetCode, name: "Skill Successor Trap Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1200 },
    { code: graveTargetCode, name: "Skill Successor Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200 },
    { code: defenderCode, name: "Skill Successor Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1900, defense: 1200 },
  ];
}

function createRestoredTrapField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 73729209, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [skillCode, targetCode] }, 1: { main: [] } });
  startDuel(session);
  const skill = requireCard(session, skillCode);
  moveFaceDownSpellTrap(session, skill, 0, 0);
  moveFaceUpAttack(session, requireCard(session, targetCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(skillCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredGraveField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 73729210, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [skillCode, graveTargetCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  const skill = moveDuelCard(session.state, requireCard(session, skillCode).uid, "graveyard", 0);
  skill.turnId = 0;
  skill.faceUp = true;
  moveFaceUpAttack(session, requireCard(session, graveTargetCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "battle";
  session.state.turn = 2;
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(skillCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Skill Successor");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("e1:SetLabel(400)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("e2:SetLabel(800)");
  expect(script).toContain("return aux.exccon(e) and Duel.IsTurnPlayer(tp) and aux.StatChangeDamageStepCondition()");
  expect(script).toContain("Duel.IsExistingTarget(Card.IsFaceup,tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel())");
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
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function moveFaceDownSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = false;
  moved.sequence = sequence;
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

function passUntilBattleWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, kind: NonNullable<DuelSession["state"]["battleWindow"]>["kind"]): void {
  let guard = 0;
  while (restored.session.state.battleWindow?.kind !== kind) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) =>
      candidate.type === "passAttack" || candidate.type === "passDamage" || candidate.type === "passChain"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
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

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) =>
      restored.session.state.chain.length > 0
        ? candidate.type === "passChain"
        : candidate.type === "passAttack" || candidate.type === "passDamage"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
}
