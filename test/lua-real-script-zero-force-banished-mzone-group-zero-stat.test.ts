import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { banishDuelCard, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const zeroForceCode = "17521642";
const banishedCode = "175216420";
const allyCode = "175216421";
const opponentCode = "175216422";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasZeroForceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${zeroForceCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const effectSetAttackFinal = 102;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasZeroForceScript)("Lua real script Zero Force banished MZONE group zero stat", () => {
  it("restores own face-up monster banish trigger into all-face-up final ATK zeroing", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${zeroForceCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createTriggeredSession({ reader, workspace });
    const zeroForce = requireCard(session, zeroForceCode);
    const banished = requireCard(session, banishedCode);
    const ally = requireCard(session, allyCode);
    const opponent = requireCard(session, opponentCode);

    expect(session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === banished.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: banished.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: zeroForce.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-1-1",
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: banished.uid,
        eventPlayer: 0,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: zeroForce.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
        sourceUid: zeroForce.uid,
        effectId: "lua-1-1011",
        player: 0,
        triggerBucket: "turnOptional",
        eventTriggerTiming: "if",
      },
    ]);
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === zeroForce.uid && action.effectId === "lua-1-1011"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(currentAttack(findCard(restored.session, ally.uid), restored.session.state)).toBe(0);
    expect(currentAttack(findCard(restored.session, opponent.uid), restored.session.state)).toBe(0);
    expect(currentAttack(findCard(restored.session, banished.uid), restored.session.state)).toBe(1800);
    expect(restored.session.state.effects.filter((effect) =>
      [ally.uid, opponent.uid].includes(effect.sourceUid ?? "") && effect.code === effectSetAttackFinal
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: resetEventStandard }, sourceUid: ally.uid, value: 0 },
      { code: effectSetAttackFinal, reset: { flags: resetEventStandard }, sourceUid: opponent.uid, value: 0 },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const zeroForce = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === zeroForceCode);
  expect(zeroForce).toBeDefined();
  return [
    { ...zeroForce!, kind: "trap", typeFlags: typeTrap },
    { code: banishedCode, name: "Zero Force Banished", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    { code: allyCode, name: "Zero Force Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2400, defense: 1000 },
    { code: opponentCode, name: "Zero Force Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 3000, defense: 1000 },
  ];
}

function createTriggeredSession({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): DuelSession {
  const session = createDuel({ seed: 17521642, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [zeroForceCode, banishedCode, allyCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  const zeroForce = moveFaceDownSpellTrap(session, requireCard(session, zeroForceCode), 0, 0);
  const banished = moveFaceUpAttack(session, requireCard(session, banishedCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(zeroForceCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  banishDuelCard(session.state, banished.uid, 0, duelReason.effect, 0, { eventReasonCardUid: zeroForce.uid, eventReasonEffectId: 1 });
  const [event] = session.state.eventHistory.filter((candidate) => candidate.eventName === "banished" && candidate.eventCardUid === banished.uid);
  expect(event).toBeDefined();
  expect(event!.eventPreviousState).toBeDefined();
  expect(event!.eventCurrentState).toBeDefined();
  session.state.pendingTriggers.push({
    id: "trigger-1-1",
    eventName: "banished",
    eventCode: 1011,
    eventCardUid: banished.uid,
    eventPlayer: 0,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: zeroForce.uid,
    eventReasonEffectId: 1,
    eventPreviousState: event!.eventPreviousState!,
    eventCurrentState: event!.eventCurrentState!,
    sourceUid: zeroForce.uid,
    effectId: "lua-1-1011",
    player: 0,
    triggerBucket: "turnOptional",
    eventTriggerTiming: "if",
  });
  return session;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Zero Force");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_REMOVE)");
  expect(script).toContain("return c:IsPreviousControler(tp) and c:IsControler(tp) and c:IsPreviousLocation(LOCATION_MZONE) and c:IsPreviousPosition(POS_FACEUP)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("for tc in aux.Next(g) do");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
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
