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
const doubleOrNothingCode = "94770493";
const attackerCode = "947704930";
const firstTargetCode = "947704931";
const secondTargetCode = "947704932";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDoubleOrNothingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${doubleOrNothingCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const effectExtraAttack = 194;
const effectSetAttackFinal = 102;
const eventBattleStart = 1132;
const eventAttackDisabled = 1142;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDoubleOrNothingScript)("Lua real script Double or Nothing attack disabled extra final stat", () => {
  it("restores attack-disabled activation into extra attack and battle-start final ATK doubling", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${doubleOrNothingCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDoubleOrNothingSession(reader, workspace);
    const doubleOrNothing = requireCard(session, doubleOrNothingCode);
    const attacker = requireCard(session, attackerCode);
    const firstTarget = requireCard(session, firstTargetCode);
    const secondTarget = requireCard(session, secondTargetCode);
    moveDuelCard(session.state, doubleOrNothing.uid, "hand", 0);
    moveFaceUpAttack(session, attacker, 0, 0);
    moveFaceUpAttack(session, firstTarget, 1, 0);
    moveFaceUpAttack(session, secondTarget, 1, 1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const firstAttack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === firstTarget.uid
    );
    expect(firstAttack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, firstAttack!);
    passAttackIfNeeded(restoredOpen, 0);

    const negated = restoredOpen.host.loadScript('Debug.Message("negate attack " .. tostring(Duel.NegateAttack()))', "double-or-nothing-negate-probe.lua");
    expect(negated.ok, negated.error).toBe(true);
    expect(restoredOpen.host.messages).toContain("negate attack true");
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "attackDisabled").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: attacker.uid, eventCode: eventAttackDisabled, eventName: "attackDisabled", eventReason: duelReason.effect, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);

    const restoredDisabled = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredDisabled);
    expectRestoredLegalActions(restoredDisabled, 0);
    const activateDouble = getLuaRestoreLegalActions(restoredDisabled, 0).find((action) =>
      action.type === "activateEffect" && action.uid === doubleOrNothing.uid && action.effectId === "lua-1-1142"
    );
    expect(activateDouble, JSON.stringify(getLuaRestoreLegalActions(restoredDisabled, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDisabled, activateDouble!);
    resolveRestoredChain(restoredDisabled);
    expect(restoredDisabled.session.state.cards.find((card) => card.uid === doubleOrNothing.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredDisabled.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid && [effectExtraAttack, eventBattleStart].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectExtraAttack, event: "continuous", reset: { flags: 1107169792 }, sourceUid: attacker.uid, value: 1 },
      { code: eventBattleStart, event: "continuous", reset: { flags: 1107169792 }, sourceUid: attacker.uid, value: undefined },
    ]);

    const restoredGranted = restoreDuelWithLuaScripts(serializeDuel(restoredDisabled.session), workspace, reader);
    expectCleanRestore(restoredGranted);
    restoredGranted.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredGranted, 0);
    const secondAttack = getLuaRestoreLegalActions(restoredGranted, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === secondTarget.uid
    );
    expect(secondAttack, JSON.stringify(getLuaRestoreLegalActions(restoredGranted, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredGranted, secondAttack!);
    passUntilFinalAttackDoubled(restoredGranted, attacker.uid);
    expect(currentAttack(restoredGranted.session.state.cards.find((card) => card.uid === attacker.uid), restoredGranted.session.state)).toBe(3600);
    expect(restoredGranted.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 1107169344 }, sourceUid: attacker.uid, value: 3600 },
    ]);
    passBattle(restoredGranted);
    expect(restoredGranted.session.state.battleDamage).toEqual({ 0: 0, 1: 2200 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const doubleOrNothing = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === doubleOrNothingCode);
  expect(doubleOrNothing).toBeDefined();
  return [
    doubleOrNothing!,
    { code: attackerCode, name: "Double or Nothing Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1800, defense: 1000 },
    { code: firstTargetCode, name: "Double or Nothing First Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: secondTargetCode, name: "Double or Nothing Second Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1400, defense: 1000 },
  ];
}

function createDoubleOrNothingSession(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelSession {
  const session = createDuel({ seed: 94770493, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [doubleOrNothingCode, attackerCode] }, 1: { main: [firstTargetCode, secondTargetCode] } });
  startDuel(session);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(doubleOrNothingCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Double or Nothing!");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_DISABLED)");
  expect(script).toContain("Duel.SetTargetCard(eg:GetFirst())");
  expect(script).toContain("tc:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1)");
  expect(script).toContain("e1:SetCode(EFFECT_EXTRA_ATTACK)");
  expect(script).toContain("e1:SetValue(tc:GetAttackAnnouncedCount())");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_START)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(e:GetHandler():GetAttack()*2)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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

function passAttackIfNeeded(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  if (restored.session.state.waitingFor !== player) return;
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack");
  if (!pass) return;
  applyRestoredActionAndAssert(restored, pass);
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

function passUntilFinalAttackDoubled(restored: ReturnType<typeof restoreDuelWithLuaScripts>, attackerUid: string): void {
  let guard = 0;
  while (!restored.session.state.effects.some((effect) => effect.sourceUid === attackerUid && effect.code === effectSetAttackFinal)) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      continue;
    }
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0 || restored.session.state.pendingTriggers.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
