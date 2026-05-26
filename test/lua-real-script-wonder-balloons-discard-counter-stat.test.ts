import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const balloonsCode = "78574395";
const discardACode = "785743950";
const discardBCode = "785743951";
const opponentMonsterCode = "785743952";
const ownMonsterCode = "785743953";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBalloonsScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${balloonsCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const counterBalloon = 0x32;

describe.skipIf(!hasUpstreamScripts || !hasBalloonsScript)("Lua real script Wonder Balloons discard counter stat", () => {
  it("restores hand discard cost into Balloon Counters and opponent ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${balloonsCode}.lua`));
    const reader = createCardReader(cards());
    const restored = createRestoredField(reader, workspace);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const balloons = requireCard(restored.session, balloonsCode);
    const discardA = requireCard(restored.session, discardACode);
    const discardB = requireCard(restored.session, discardBCode);
    const opponentMonster = requireCard(restored.session, opponentMonsterCode);
    const ownMonster = requireCard(restored.session, ownMonsterCode);
    const ignition = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === balloons.uid && action.effectId === "lua-3"
    );
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, ignition!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, discardA.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: balloons.uid,
      reasonEffectId: 3,
    });
    expect(findCard(restored.session, discardB.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: balloons.uid,
      reasonEffectId: 3,
    });
    expect(getDuelCardCounter(findCard(restored.session, balloons.uid), counterBalloon)).toBe(2);
    expect(currentAttack(findCard(restored.session, opponentMonster.uid), restored.session.state)).toBe(1400);
    expect(currentAttack(findCard(restored.session, ownMonster.uid), restored.session.state)).toBe(1700);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "counterAdded").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "counterAdded", eventCardUid: balloons.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: balloons.uid, eventReasonEffectId: 3 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: balloonsCode, name: "Wonder Balloons", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: discardACode, name: "Wonder Balloons Discard A", kind: "spell", typeFlags: typeSpell },
    { code: discardBCode, name: "Wonder Balloons Discard B", kind: "spell", typeFlags: typeSpell },
    { code: opponentMonsterCode, name: "Wonder Balloons Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2000, defense: 1000 },
    { code: ownMonsterCode, name: "Wonder Balloons Own Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1200 },
  ];
}

function createRestoredField(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 78574395, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [balloonsCode, discardACode, discardBCode, ownMonsterCode] }, 1: { main: [opponentMonsterCode] } });
  startDuel(session);
  moveFaceUpSpell(session, requireCard(session, balloonsCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, discardACode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, discardBCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, ownMonsterCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, opponentMonsterCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerWonderBalloons(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerWonderBalloons(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(balloonsCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Wonder Balloons");
  expect(script).toContain("c:EnableCounterPermit(0x32)");
  expect(script).toContain("s.counter_place_list={0x32}");
  expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsAbleToGraveAsCost,tp,LOCATION_HAND,0,1,nil)");
  expect(script).toContain("local ct=Duel.DiscardHand(tp,Card.IsAbleToGraveAsCost,1,60,REASON_COST)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,e:GetLabel(),0,0x32)");
  expect(script).toContain("c:AddCounter(0x32,e:GetLabel())");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e3:SetTargetRange(0,LOCATION_MZONE)");
  expect(script).toContain("return e:GetHandler():GetCounter(0x32)*-300");
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

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.sequence = sequence;
  return moved;
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
  const waitingFor = restored.session.state.waitingFor;
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
