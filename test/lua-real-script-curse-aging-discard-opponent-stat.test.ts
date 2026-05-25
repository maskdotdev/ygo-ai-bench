import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const agingCode = "41398771";
const discardCode = "413987710";
const ownFaceupCode = "413987711";
const opponentFirstCode = "413987712";
const opponentSecondCode = "413987713";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasAgingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${agingCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;
const resetStandardPhaseEnd = 1107169792;
const reasonDiscardCost = duelReason.cost | duelReason.discard;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasAgingScript)("Lua real script Curse of Aging discard opponent stat", () => {
  it("restores discard cost into opponent face-up ATK and DEF drops", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${agingCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredField({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const aging = requireCard(restored.session, agingCode);
    const discard = requireCard(restored.session, discardCode);
    const ownFaceup = requireCard(restored.session, ownFaceupCode);
    const opponentFirst = requireCard(restored.session, opponentFirstCode);
    const opponentSecond = requireCard(restored.session, opponentSecondCode);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === aging.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, discard.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      reason: reasonDiscardCost,
      reasonPlayer: 0,
      reasonCardUid: aging.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(findCard(restored.session, ownFaceup.uid), restored.session.state)).toBe(1800);
    expect(currentDefense(findCard(restored.session, ownFaceup.uid), restored.session.state)).toBe(1200);
    expect(currentAttack(findCard(restored.session, opponentFirst.uid), restored.session.state)).toBe(1100);
    expect(currentDefense(findCard(restored.session, opponentFirst.uid), restored.session.state)).toBe(600);
    expect(currentAttack(findCard(restored.session, opponentSecond.uid), restored.session.state)).toBe(1600);
    expect(currentDefense(findCard(restored.session, opponentSecond.uid), restored.session.state)).toBe(1500);
    expect(restored.session.state.effects
      .filter((effect) => [effectUpdateAttack, effectUpdateDefense].includes(effect.code ?? -1))
      .map((effect) => ({
        code: effect.code,
        reset: effect.reset,
        sourceUid: effect.sourceUid,
        value: effect.value,
      }))).toEqual([
        { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: opponentFirst.uid, value: -500 },
        { code: effectUpdateDefense, reset: { flags: resetStandardPhaseEnd }, sourceUid: opponentFirst.uid, value: -500 },
        { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: opponentSecond.uid, value: -500 },
        { code: effectUpdateDefense, reset: { flags: resetStandardPhaseEnd }, sourceUid: opponentSecond.uid, value: -500 },
      ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "discarded").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "discarded", eventCardUid: discard.uid, eventReason: reasonDiscardCost, eventReasonPlayer: 0, eventReasonCardUid: aging.uid, eventReasonEffectId: 1, previous: "hand", current: "graveyard" },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const aging = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === agingCode);
  expect(aging).toBeDefined();
  return [
    { ...aging!, kind: "trap", typeFlags: typeTrap },
    { code: discardCode, name: "Curse of Aging Discard Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: ownFaceupCode, name: "Curse of Aging Own Face-up Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200 },
    { code: opponentFirstCode, name: "Curse of Aging Opponent First", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1100 },
    { code: opponentSecondCode, name: "Curse of Aging Opponent Second", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2100, defense: 2000 },
  ];
}

function createRestoredField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 41398771, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [agingCode, discardCode, ownFaceupCode] }, 1: { main: [opponentFirstCode, opponentSecondCode] } });
  startDuel(session);
  moveFaceDownSpellTrap(session, requireCard(session, agingCode), 0, 0);
  moveToHand(session, requireCard(session, discardCode), 0);
  moveFaceUpAttack(session, requireCard(session, ownFaceupCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, opponentFirstCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentSecondCode), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(agingCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Curse of Aging");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsDiscardable,tp,LOCATION_HAND,0,1,e:GetHandler())");
  expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil)");
  expect(script).toContain("local g=Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-500)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
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

function moveToHand(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  return moveDuelCard(session.state, card.uid, "hand", player);
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
