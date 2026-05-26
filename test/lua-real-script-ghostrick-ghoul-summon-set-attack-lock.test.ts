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
const ghoulCode = "85463083";
const allyCode = "854630830";
const opponentGhostrickCode = "854630831";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGhoulScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ghoulCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceZombie = 0x10;
const attributeDark = 0x10;
const setGhostrick = 0x8d;

describe.skipIf(!hasUpstreamScripts || !hasGhoulScript)("Lua real script Ghostrick Ghoul summon set attack lock", () => {
  it("restores cannot-summon gating, turn-set, ATK final sum, attack oath, and battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${ghoulCode}.lua`));
    const reader = createCardReader(cards());

    const lockedSummonSession = createDuel({ seed: 85463083, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(lockedSummonSession, { 0: { main: [ghoulCode] }, 1: { main: [] } });
    startDuel(lockedSummonSession);
    const lockedGhoul = requireCard(lockedSummonSession, ghoulCode);
    moveToHand(lockedSummonSession, lockedGhoul, 0);
    lockedSummonSession.state.phase = "main1";
    lockedSummonSession.state.turnPlayer = 0;
    lockedSummonSession.state.waitingFor = 0;

    const lockedHost = createLuaScriptHost(lockedSummonSession, workspace);
    expect(lockedHost.loadCardScript(Number(ghoulCode), workspace).ok).toBe(true);
    expect(lockedHost.registerInitialEffects()).toBe(1);

    const restoredLockedSummon = restoreDuelWithLuaScripts(serializeDuel(lockedSummonSession), workspace, reader);
    expectCleanRestore(restoredLockedSummon);
    expectRestoredLegalActions(restoredLockedSummon, 0);
    expect(getLuaRestoreLegalActions(restoredLockedSummon, 0).filter((action) => action.type === "normalSummon" && action.uid === lockedGhoul.uid)).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredLockedSummon, 0).some((action) => action.type === "setMonster" && action.uid === lockedGhoul.uid)).toBe(true);

    const unlockedSummonSession = createDuel({ seed: 85463084, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(unlockedSummonSession, { 0: { main: [ghoulCode, allyCode] }, 1: { main: [] } });
    startDuel(unlockedSummonSession);
    const unlockedGhoul = requireCard(unlockedSummonSession, ghoulCode);
    const unlockAlly = requireCard(unlockedSummonSession, allyCode);
    moveToHand(unlockedSummonSession, unlockedGhoul, 0);
    moveFaceUpAttack(unlockedSummonSession, unlockAlly, 0, 0);
    unlockedSummonSession.state.phase = "main1";
    unlockedSummonSession.state.turnPlayer = 0;
    unlockedSummonSession.state.waitingFor = 0;

    const unlockedHost = createLuaScriptHost(unlockedSummonSession, workspace);
    expect(unlockedHost.loadCardScript(Number(ghoulCode), workspace).ok).toBe(true);
    expect(unlockedHost.registerInitialEffects()).toBe(1);
    const restoredUnlockedSummon = restoreDuelWithLuaScripts(serializeDuel(unlockedSummonSession), workspace, reader);
    expectCleanRestore(restoredUnlockedSummon);
    expectRestoredLegalActions(restoredUnlockedSummon, 0);
    expect(getLuaRestoreLegalActions(restoredUnlockedSummon, 0).some((action) => action.type === "normalSummon" && action.uid === unlockedGhoul.uid)).toBe(true);

    const setSession = createDuel({ seed: 85463085, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(setSession, { 0: { main: [ghoulCode] }, 1: { main: [] } });
    startDuel(setSession);
    const setGhoul = requireCard(setSession, ghoulCode);
    moveFaceUpAttack(setSession, setGhoul, 0, 0);
    setSession.state.phase = "main1";
    setSession.state.turnPlayer = 0;
    setSession.state.waitingFor = 0;

    const setHost = createLuaScriptHost(setSession, workspace);
    expect(setHost.loadCardScript(Number(ghoulCode), workspace).ok).toBe(true);
    expect(setHost.registerInitialEffects()).toBe(1);

    const restoredSetOpen = restoreDuelWithLuaScripts(serializeDuel(setSession), workspace, reader);
    expectCleanRestore(restoredSetOpen);
    expectRestoredLegalActions(restoredSetOpen, 0);
    const turnSet = getLuaRestoreLegalActions(restoredSetOpen, 0).find((action) => action.type === "activateEffect" && action.uid === setGhoul.uid && action.effectId === "lua-2");
    expect(turnSet, JSON.stringify(getLuaRestoreLegalActions(restoredSetOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetOpen, turnSet!);
    expect(restoredSetOpen.session.state.cards.find((card) => card.uid === setGhoul.uid)).toMatchObject({ location: "monsterZone", position: "faceDownDefense", faceUp: false });
    expect(restoredSetOpen.session.state.eventHistory.filter((event) => event.eventName === "positionChanged")).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: setGhoul.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: setGhoul.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 0 },
      },
    ]);
    const restoredSetAfterResolution = restoreDuelWithLuaScripts(serializeDuel(restoredSetOpen.session), workspace, reader);
    expectCleanRestore(restoredSetAfterResolution);
    expectRestoredLegalActions(restoredSetAfterResolution, 0);

    const attackSession = createDuel({ seed: 85463086, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(attackSession, { 0: { main: [ghoulCode, allyCode] }, 1: { main: [opponentGhostrickCode] } });
    startDuel(attackSession);
    const attackGhoul = requireCard(attackSession, ghoulCode);
    const attackAlly = requireCard(attackSession, allyCode);
    const opponentGhostrick = requireCard(attackSession, opponentGhostrickCode);
    moveFaceUpAttack(attackSession, attackAlly, 0, 0);
    moveFaceUpAttack(attackSession, attackGhoul, 0, 1);
    moveFaceUpAttack(attackSession, opponentGhostrick, 1, 0);
    attackSession.state.phase = "main1";
    attackSession.state.turnPlayer = 0;
    attackSession.state.waitingFor = 0;

    const attackHost = createLuaScriptHost(attackSession, workspace);
    expect(attackHost.loadCardScript(Number(ghoulCode), workspace).ok).toBe(true);
    expect(attackHost.registerInitialEffects()).toBe(1);

    const restoredAttackOpen = restoreDuelWithLuaScripts(serializeDuel(attackSession), workspace, reader);
    expectCleanRestore(restoredAttackOpen);
    expectRestoredLegalActions(restoredAttackOpen, 0);
    const attackBoost = getLuaRestoreLegalActions(restoredAttackOpen, 0).find((action) => action.type === "activateEffect" && action.uid === attackGhoul.uid && action.effectId === "lua-3");
    expect(attackBoost, JSON.stringify(getLuaRestoreLegalActions(restoredAttackOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttackOpen, attackBoost!);
    expect(restoredAttackOpen.session.state.chain).toEqual([]);
    expect(currentAttack(restoredAttackOpen.session.state.cards.find((card) => card.uid === attackAlly.uid), restoredAttackOpen.session.state)).toBe(3200);
    expect(restoredAttackOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: attackAlly.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredBattleOpen = restoreDuelWithLuaScripts(serializeDuel(restoredAttackOpen.session), workspace, reader);
    expectCleanRestore(restoredBattleOpen);
    expectRestoredLegalActions(restoredBattleOpen, 0);
    expect(currentAttack(restoredBattleOpen.session.state.cards.find((card) => card.uid === attackAlly.uid), restoredBattleOpen.session.state)).toBe(3200);
    restoredBattleOpen.session.state.phase = "battle";
    restoredBattleOpen.session.state.turnPlayer = 0;
    restoredBattleOpen.session.state.waitingFor = 0;
    const battleActions = getLuaRestoreLegalActions(restoredBattleOpen, 0);
    expect(battleActions.filter((action) => action.type === "declareAttack" && action.attackerUid === attackGhoul.uid)).toEqual([]);
    const allyAttack = battleActions.find((action) => action.type === "declareAttack" && action.attackerUid === attackAlly.uid && action.targetUid === opponentGhostrick.uid);
    expect(allyAttack, JSON.stringify(battleActions, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleOpen, allyAttack!);
    finishRestoredBattle(restoredBattleOpen);
    expect(restoredBattleOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 2000 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SUMMON)");
  expect(script).toContain("return not Duel.IsExistingMatchingCard(s.filter,e:GetHandlerPlayer(),LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("e2:SetCategory(CATEGORY_POSITION+CATEGORY_SET)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("c:RegisterFlagEffect(id,RESET_EVENT|(RESETS_STANDARD_PHASE_END&~RESET_TURN_SET),0,1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_POSITION,c,1,tp,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("Duel.ChangePosition(c,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("e3:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e3:SetCountLimit(1)");
  expect(script).toContain("return Duel.IsPhase(PHASE_MAIN1)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_OATH)");
  expect(script).toContain("e1:SetTargetRange(LOCATION_MZONE,0)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("local g=Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("local catk=bc:GetBaseAttack()");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END,2)");
}

function cards(): DuelCardData[] {
  return [
    { code: ghoulCode, name: "Ghostrick Ghoul", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 3, attack: 1100, defense: 1200, setcodes: [setGhostrick] },
    { code: allyCode, name: "Ghostrick Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 3, attack: 900, defense: 1000, setcodes: [setGhostrick] },
    { code: opponentGhostrickCode, name: "Opponent Ghostrick", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 3, attack: 1200, defense: 1000, setcodes: [setGhostrick] },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveToHand(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "hand", player);
  moved.faceUp = false;
  moved.position = "faceDown";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
