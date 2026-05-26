import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const combatWheelCode = "12501230";
const discardCode = "125012301";
const allyCode = "125012302";
const opponentAttackerCode = "125012303";
const combatCounter = 0x20e;
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Combat Wheel counter boost lock", () => {
  it("restores damage-step quick discard cost into ATK boost, counter placement, and battle-target protection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${combatWheelCode}.lua`);
    expect(script).toContain("c:EnableCounterPermit(0x20e)");
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_COUNT)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BE_BATTLE_TARGET)");
    expect(script).toContain("local atk=Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,0,c):GetSum(Card.GetAttack)");
    expect(script).toContain("c:UpdateAttack(atk//2)");
    expect(script).toContain("c:AddCounter(0x20e,1)");
    expect(script).toContain("e4a:SetCode(EVENT_LEAVE_FIELD_P)");
    expect(script).toContain("e4:SetCode(EVENT_BATTLE_DESTROYED)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === combatWheelCode),
      { code: discardCode, name: "Combat Wheel Discard", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: allyCode, name: "Combat Wheel Ally", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1000 },
      { code: opponentAttackerCode, name: "Combat Wheel Opponent Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 3000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 12501230, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [combatWheelCode, discardCode, allyCode] }, 1: { main: [opponentAttackerCode] } });
    startDuel(session);

    const combatWheel = requireCard(session, combatWheelCode);
    const discard = requireCard(session, discardCode);
    const ally = requireCard(session, allyCode);
    const opponentAttacker = requireCard(session, opponentAttackerCode);
    moveFaceUpAttack(session, combatWheel, 0);
    moveDuelCard(session.state, discard.uid, "hand", 0);
    moveFaceUpAttack(session, ally, 0);
    moveFaceUpAttack(session, opponentAttacker, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(combatWheelCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).not.toContain("unsupported");

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const boost = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === combatWheel.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, boost!);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredOpen);

    const restoredCombatWheel = restoredOpen.session.state.cards.find((card) => card.uid === combatWheel.uid)!;
    expect(restoredOpen.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonCardUid: combatWheel.uid,
      reasonEffectId: 5,
    });
    expect(currentAttack(restoredCombatWheel, restoredOpen.session.state)).toBe((combatWheel.data.attack ?? 0) + 800);
    expect(getDuelCardCounter(restoredCombatWheel, combatCounter)).toBe(1);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === combatWheel.uid && effect.code === 70)).toEqual([
      expect.objectContaining({ code: 70, range: ["monsterZone"], targetRange: [4, 0], reset: { flags: 1073742336 }, value: 1 }),
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["discarded", "counterAdded"].includes(event.eventName))).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: discard.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: combatWheel.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: combatWheel.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: combatWheel.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(getLuaRestoreLegalActions(restoredOpen, 1).some((action) => action.type === "declareAttack" && action.attackerUid === opponentAttacker.uid && action.targetUid === ally.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredOpen, 1).some((action) => action.type === "declareAttack" && action.attackerUid === opponentAttacker.uid && action.targetUid === combatWheel.uid)).toBe(true);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player).position = "faceUpAttack";
  card.faceUp = true;
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

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
