import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentCardMatchesCode } from "#duel/card-code-state.js";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const siegerCode = "46724542";
const cyberDragonCode = "70095154";
const machineTargetCode = "467245420";
const defenderCode = "467245421";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSiegerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${siegerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceMachine = 0x20;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasSiegerScript)("Lua real script Cyber Dragon Sieger code stat damage", () => {
  it("restores Cyber Dragon code change, battle quick stat boost, and self battle-damage prevention", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${siegerCode}.lua`);
    expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_MACHINE),2,2,s.lcheck)");
    expect(script).toContain("g:IsExists(Card.IsSummonCode,1,nil,lc,sumtype,tp,CARD_CYBER_DRAGON)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_CODE)");
    expect(script).toContain("e1:SetValue(CARD_CYBER_DRAGON)");
    expect(script).toContain("e2:SetCondition(s.con)");
    expect(script).toContain("Duel.IsBattlePhase() and aux.StatChangeDamageStepCondition()");
    expect(script).toContain("return c:IsFaceup() and c:IsAttackAbove(2100) and c:IsRace(RACE_MACHINE)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e3:SetCode(EFFECT_NO_BATTLE_DAMAGE)");
    expect(script).toContain("e4:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");

    const cards: DuelCardData[] = [
      { code: siegerCode, name: "Cyber Dragon Sieger", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceMachine, level: 2, attack: 2100, defense: 0 },
      { code: machineTargetCode, name: "Sieger Machine Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 4, attack: 2200, defense: 1600 },
      { code: defenderCode, name: "Sieger Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 2500, defense: 2500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 46724542, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [machineTargetCode], extra: [siegerCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const sieger = requireCard(session, siegerCode);
    const target = requireCard(session, machineTargetCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, target, 0);
    moveFaceUpAttack(session, sieger, 0);
    moveFaceUpAttack(session, defender, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(siegerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const restoredSieger = restoredOpen.session.state.cards.find((card) => card.uid === sieger.uid)!;
    expect(currentCardMatchesCode(restoredSieger, restoredOpen.session.state, cyberDragonCode)).toBe(true);
    expect(currentCardMatchesCode(restoredSieger, restoredOpen.session.state, siegerCode)).toBe(false);

    const openingAttack = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) =>
      candidate.type === "declareAttack" && candidate.attackerUid === target.uid && candidate.targetUid === defender.uid
    );
    expect(openingAttack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, openingAttack!);
    const opponentPass = getLuaRestoreLegalActions(restoredOpen, 1).find((candidate) => candidate.type === "passAttack");
    expect(opponentPass, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, opponentPass!);

    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) =>
      candidate.type === "activateEffect" && candidate.uid === sieger.uid
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, action!);

    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid)!, restoredOpen.session.state)).toBe(4300);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === target.uid)!, restoredOpen.session.state)).toBe(3700);
    expect(restoredOpen.session.state.effects.filter((effect) => [100, 104, 200, 201].includes(effect.code ?? -1)).map((effect) => ({
      sourceUid: effect.sourceUid,
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { sourceUid: target.uid, code: 100, property: 0x400, reset: { flags: 1107169792 }, value: 2100 },
      { sourceUid: target.uid, code: 104, property: 0x400, reset: { flags: 1107169792 }, value: 2100 },
      { sourceUid: sieger.uid, code: 200, property: undefined, reset: { flags: 1107169792 }, value: undefined },
      { sourceUid: sieger.uid, code: 201, property: undefined, reset: { flags: 1107169792 }, value: 1 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    passBattleResponses(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 1800 });
    expect(restoredBattle.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(6200);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === sieger.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "graveyard", controller: 1, reason: 0x21 });
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
