import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Delta Attacker group direct attack", () => {
  it("restores operation-registered direct attack effects for three same-code face-up Normal monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const deltaAttackerCode = "39719977";
    const normalCode = "39719971";
    const effectDecoyCode = "39719972";
    const defenderCode = "39719973";
    const script = workspace.readScript(`c${deltaAttackerCode}.lua`);
    expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_MZONE,0,3,nil,tp)");
    expect(script).toContain("return c:IsFaceup() and (tpe&TYPE_NORMAL)~=0 and (tpe&TYPE_TOKEN)==0");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,0,nil,tp)");
    expect(script).toContain("for tc in aux.Next(g) do");
    expect(script).toContain("e1:SetCode(EFFECT_DIRECT_ATTACK)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === deltaAttackerCode),
      { code: normalCode, name: "Delta Attacker Normal Trio", kind: "monster", typeFlags: typeMonster | typeNormal, level: 4, attack: 1000, defense: 1000 },
      { code: effectDecoyCode, name: "Delta Attacker Effect Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: defenderCode, name: "Delta Attacker Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3971, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [deltaAttackerCode, normalCode, normalCode, normalCode, effectDecoyCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const deltaAttacker = requireCard(session, deltaAttackerCode);
    const normalTrio = session.state.cards.filter((card) => card.code === normalCode);
    const effectDecoy = requireCard(session, effectDecoyCode);
    const defender = requireCard(session, defenderCode);
    expect(normalTrio).toHaveLength(3);
    moveDuelCard(session.state, deltaAttacker.uid, "hand", 0);
    for (const [index, normal] of normalTrio.entries()) moveFaceUpAttack(session, normal, 0, index);
    moveFaceUpAttack(session, effectDecoy, 0, 3);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(deltaAttackerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const setDeltaAttacker = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "setSpellTrap" && action.uid === deltaAttacker.uid);
    expect(setDeltaAttacker, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, setDeltaAttacker!);
    const restoredSet = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredSet);
    expectRestoredLegalActions(restoredSet, 0);
    const activation = getLuaRestoreLegalActions(restoredSet, 0).find((action) => action.type === "activateEffect" && action.uid === deltaAttacker.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredSet, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSet, activation!);
    passChain(restoredSet);

    expect(restoredSet.session.state.effects.filter((effect) => effect.code === 74 && normalTrio.some((normal) => normal.uid === effect.sourceUid)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      sourceUid: effect.sourceUid,
    }))).toEqual(normalTrio.map((normal) => ({
      code: 74,
      event: "continuous",
      sourceUid: normal.uid,
    })));
    expect(restoredSet.session.state.effects.some((effect) => effect.code === 74 && effect.sourceUid === effectDecoy.uid)).toBe(false);

    restoredSet.session.state.phase = "battle";
    restoredSet.session.state.waitingFor = 0;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredSet.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const battleActions = getLuaRestoreLegalActions(restoredBattle, 0);
    for (const normal of normalTrio) {
      expect(hasAttack(battleActions, normal.uid, defender.uid)).toBe(true);
      expect(hasDirectAttack(battleActions, normal.uid)).toBe(true);
    }
    expect(hasAttack(battleActions, effectDecoy.uid, defender.uid)).toBe(true);
    expect(hasDirectAttack(battleActions, effectDecoy.uid)).toBe(false);

    const directAttack = battleActions.find((action) => action.type === "declareAttack" && action.attackerUid === normalTrio[0]!.uid && action.directAttack);
    expect(directAttack, JSON.stringify(battleActions, null, 2)).toBeDefined();
    applyAndAssert(restoredBattle.session, directAttack!);
    passBattle(restoredBattle.session);
    expect(restoredBattle.session.state.battleDamage[1]).toBe(1000);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: normalTrio[0]!.uid,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.battle,
        eventReasonCardUid: normalTrio[0]!.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 4 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function moveFaceUpAttack(session: DuelSession, card: DuelSession["state"]["cards"][number], player: 0 | 1, zoneIndex: number): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player, zoneIndex);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passBattle(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function hasDirectAttack(actions: DuelAction[], attackerUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.directAttack);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
