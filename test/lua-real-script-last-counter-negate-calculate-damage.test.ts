import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const lastCounterCode = "86049351";
const hasLastCounterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lastCounterCode}.lua`));
const battlingBoxerCode = "860493510";
const replacementBoxerCode = "860493511";
const opponentCode = "860493512";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const setBattlinBoxer = 0x84;

describe.skipIf(!hasUpstreamScripts || !hasLastCounterScript)("Lua real script Last Counter negate and CalculateDamage", () => {
  it("restores attack-announcement negation, SendtoGrave, ATK gain, CalculateDamage, and effect damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${lastCounterCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DAMAGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("Duel.GetBattleMonster(tp)");
    expect(script).toContain("Duel.NegateAttack()");
    expect(script).toContain("Duel.SendtoGrave(tc,REASON_EFFECT)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_MZONE,0,1,1,nil,pos)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(atk)");
    expect(script).toContain("Duel.CalculateDamage(bc,sc)");
    expect(script).toContain("Duel.Damage(tp,atk,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: lastCounterCode, name: "Last Counter", kind: "trap", typeFlags: typeTrap },
      { code: battlingBoxerCode, name: "Last Counter Battling Boxer", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBattlinBoxer], level: 4, attack: 1000, defense: 1000 },
      { code: replacementBoxerCode, name: "Last Counter Replacement Boxer", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBattlinBoxer], level: 4, attack: 1200, defense: 1000 },
      { code: opponentCode, name: "Last Counter Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 86049351, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lastCounterCode, battlingBoxerCode, replacementBoxerCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const lastCounter = requireCard(session, lastCounterCode);
    const battlingBoxer = requireCard(session, battlingBoxerCode);
    const replacementBoxer = requireCard(session, replacementBoxerCode);
    const opponent = requireCard(session, opponentCode);
    moveDuelCard(session.state, lastCounter.uid, "spellTrapZone", 0);
    lastCounter.turnId = 0;
    lastCounter.position = "faceDown";
    lastCounter.faceUp = false;
    moveDuelCard(session.state, battlingBoxer.uid, "monsterZone", 0).position = "faceUpAttack";
    battlingBoxer.faceUp = true;
    moveDuelCard(session.state, replacementBoxer.uid, "monsterZone", 0).position = "faceUpAttack";
    replacementBoxer.faceUp = true;
    moveDuelCard(session.state, opponent.uid, "monsterZone", 1).position = "faceUpAttack";
    opponent.faceUp = true;
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lastCounterCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === opponent.uid && action.targetUid === battlingBoxer.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    if (session.state.waitingFor === 1) {
      const pass = getLegalActions(session, 1).find((action) => action.type === "passAttack");
      expect(pass, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
      applyAndAssert(session, pass!);
    }

    const restoredAttack = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const activation = getLuaRestoreLegalActions(restoredAttack, 0).find((action) => action.type === "activateEffect" && action.uid === lastCounter.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, activation!);

    expect(restoredAttack.session.state.currentAttack).toBeUndefined();
    expect(restoredAttack.session.state.pendingBattle).toBeUndefined();
    expect(restoredAttack.session.state.attackCanceledUids).toEqual([opponent.uid]);
    expect(restoredAttack.session.state.cards.find((card) => card.uid === battlingBoxer.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: lastCounter.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredAttack.session.state.cards.find((card) => card.uid === replacementBoxer.uid), restoredAttack.session.state)).toBe(3000);
    expect(restoredAttack.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: replacementBoxer.uid,
    });
    expect(restoredAttack.session.state.players[0].lifePoints).toBe(6200);
    expect(restoredAttack.session.state.players[1].lifePoints).toBe(6800);
    expect(restoredAttack.session.state.battleDamage).toEqual({ 0: 0, 1: 1200 });
    expect(restoredAttack.session.state.eventHistory.filter((event) => ["sentToGraveyard", "battleDamageDealt", "battleDestroyed", "damageDealt"].includes(event.eventName) && event.eventCardUid !== lastCounter.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: battlingBoxer.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: lastCounter.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: replacementBoxer.uid,
        eventPlayer: 1,
        eventValue: 1200,
        eventReason: duelReason.battle,
        eventReasonPlayer: 0,
        eventReasonCardUid: replacementBoxer.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: opponent.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: replacementBoxer.uid,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: opponent.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: replacementBoxer.uid,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 1800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: lastCounter.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
