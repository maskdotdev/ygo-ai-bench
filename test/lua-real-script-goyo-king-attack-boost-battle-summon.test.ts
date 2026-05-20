import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const goyoKingCode = "84305651";
const allySynchroCode = "843056511";
const battleTargetCode = "843056512";
const typeMonster = 0x1;
const typeSynchro = 0x2000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Goyo King attack boost and battle summon", () => {
  it("restores attack-announcement Synchro count ATK boost and battle-destroying SelectOption Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${goyoKingCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("Duel.GetAttackTarget()~=nil");
    expect(script).toContain("Duel.GetMatchingGroupCount(s.filter,tp,LOCATION_MZONE,0,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYING)");
    expect(script).toContain("local bc=e:GetHandler():GetBattleTarget()");
    expect(script).toContain("Duel.SelectOption(tp,aux.Stringid(id,1),aux.Stringid(id,2))");
    expect(script).toContain("Duel.SetTargetCard(bc)");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === goyoKingCode),
      { code: allySynchroCode, name: "Goyo King Ally Synchro", kind: "extra", typeFlags: typeMonster | typeSynchro, level: 6, race: raceWarrior, attribute: attributeEarth, attack: 1800, defense: 1000 },
      { code: battleTargetCode, name: "Goyo King Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 84305651, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [goyoKingCode], extra: [allySynchroCode] }, 1: { main: [battleTargetCode] } });
    startDuel(session);

    const goyoKing = requireCard(session, goyoKingCode);
    const allySynchro = requireCard(session, allySynchroCode);
    const battleTarget = requireCard(session, battleTargetCode);
    moveDuelCard(session.state, goyoKing.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, allySynchro.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, battleTarget.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(goyoKingCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const baseAttack = currentAttack(goyoKing, session.state);
    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === goyoKing.uid && action.targetUid === battleTarget.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.pendingTriggers).toMatchObject([
      { effectId: "lua-2-1130", eventName: "attackDeclared", player: 0, sourceUid: goyoKing.uid, triggerBucket: "turnMandatory" },
    ]);

    const restoredAttack = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const attackTrigger = getLuaRestoreLegalActions(restoredAttack, 0).find((action) => action.type === "activateTrigger" && action.uid === goyoKing.uid);
    expect(attackTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredAttack, attackTrigger!);
    expect(currentAttack(restoredAttack.session.state.cards.find((card) => card.uid === goyoKing.uid)!, restoredAttack.session.state)).toBe(baseAttack + 800);
    expect(restoredAttack.session.state.effects.filter((effect) => effect.sourceUid === goyoKing.uid && effect.code === 100)).toEqual([
      expect.objectContaining({ code: 100, sourceUid: goyoKing.uid, reset: { flags: 1107234848 }, value: 800 }),
    ]);
    passRestoredBattleResponses(restoredAttack);

    expect(restoredAttack.session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reasonCardUid: goyoKing.uid,
      previousLocation: "monsterZone",
      previousPosition: "faceUpAttack",
    });
    expect(restoredAttack.session.state.pendingTriggers).toMatchObject([
      { effectId: "lua-3-1139", eventName: "battleDestroyed", player: 0, sourceUid: goyoKing.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredBattleDestroying = restoreDuelWithLuaScripts(serializeDuel(restoredAttack.session), workspace, reader);
    expectCleanRestore(restoredBattleDestroying);
    expectRestoredLegalActions(restoredBattleDestroying, 0);
    const summonTrigger = getLuaRestoreLegalActions(restoredBattleDestroying, 0).find((action) => action.type === "activateTrigger" && action.uid === goyoKing.uid);
    expect(summonTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattleDestroying, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattleDestroying, summonTrigger!);

    expect(restoredBattleDestroying.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectOption", player: 0, options: [0], descriptions: [1348890417], returned: 0 },
    ]);
    expect(restoredBattleDestroying.session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: goyoKing.uid,
      reasonEffectId: 3,
    });
    expect(restoredBattleDestroying.session.state.currentAttack).toBeUndefined();
    expect(restoredBattleDestroying.session.state.pendingBattle).toBeUndefined();
    expect(restoredBattleDestroying.session.state.eventHistory.filter((event) => ["attackDeclared", "battleDestroyed", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: goyoKing.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: battleTarget.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: goyoKing.uid,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: battleTarget.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: goyoKing.uid,
        eventReasonEffectId: 3,
        eventUids: [battleTarget.uid],
        eventPreviousState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
