import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const tensenCode = "44920699";
const beastWarriorCode = "449206990";
const secondBeastWarriorCode = "449206991";
const warriorCode = "449206992";
const defenderCode = "449206993";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasTensenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${tensenCode}.lua`));
const typeMonster = 0x1;
const raceWarrior = 0x1;
const raceBeastWarrior = 0x8000;
const attributeFire = 0x4;
const effectUpdateAttack = 100;
const effectFlagCardTargetDamageStep = 0x4010;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasTensenScript)("Lua real script Fire Formation - Tensen damage-step race stat", () => {
  it("restores Beast-Warrior field aura and targeted Damage Step ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${tensenCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 44920699, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tensenCode, beastWarriorCode, secondBeastWarriorCode, warriorCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const tensen = requireCard(session, tensenCode);
    const beastWarrior = requireCard(session, beastWarriorCode);
    const secondBeastWarrior = requireCard(session, secondBeastWarriorCode);
    const warrior = requireCard(session, warriorCode);
    const defender = requireCard(session, defenderCode);
    moveSetSpellTrap(session, tensen, 0);
    moveFaceUpAttack(session, beastWarrior, 0, 0);
    moveFaceUpAttack(session, secondBeastWarrior, 0, 1);
    moveFaceUpAttack(session, warrior, 0, 2);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tensenCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) =>
      effect.sourceUid === tensen.uid && effect.event === "continuous" && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      id: effect.id,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      {
        code: effectUpdateAttack,
        controller: 0,
        id: "lua-2-100",
        luaTargetDescriptor: "target:race:32768",
        range: ["spellTrapZone"],
        sourceUid: tensen.uid,
        targetRange: [4, 0],
        value: 300,
      },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(currentAttack(findCard(restoredOpen.session, beastWarrior.uid), restoredOpen.session.state)).toBe(1800);
    expect(currentAttack(findCard(restoredOpen.session, secondBeastWarrior.uid), restoredOpen.session.state)).toBe(1200);
    expect(currentAttack(findCard(restoredOpen.session, warrior.uid), restoredOpen.session.state)).toBe(1600);

    const attack = getLegalActions(session, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === beastWarrior.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    const opponentPass = getLegalActions(session, 1).find((action) => action.type === "passAttack");
    expect(opponentPass, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, opponentPass!);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activate = getLuaRestoreLegalActions(restoredActivation, 0).find((action) =>
      action.type === "activateEffect" && action.uid === tensen.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivation, activate!);
    resolveRestoredChain(restoredActivation);

    expect(restoredActivation.session.state.effects.filter((effect) =>
      effect.sourceUid === beastWarrior.uid && effect.event === "continuous" && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      {
        code: effectUpdateAttack,
        event: "continuous",
        property: undefined,
        reset: { flags: resetStandardPhaseEnd },
        sourceUid: beastWarrior.uid,
        value: 700,
      },
    ]);
    expect(restoredActivation.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: beastWarrior.uid, eventCode: 1028, eventName: "becameTarget", relatedEffectId: 1 },
    ]);

    const restoredAfterActivation = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expectCleanRestore(restoredAfterActivation);
    expectRestoredLegalActions(restoredAfterActivation, 0);
    expect(currentAttack(findCard(restoredAfterActivation.session, beastWarrior.uid), restoredAfterActivation.session.state)).toBe(2800);
    expect(currentAttack(findCard(restoredAfterActivation.session, secondBeastWarrior.uid), restoredAfterActivation.session.state)).toBe(1500);
    expect(currentAttack(findCard(restoredAfterActivation.session, warrior.uid), restoredAfterActivation.session.state)).toBe(1600);
    passRestoredBattle(restoredAfterActivation);
    expect(restoredAfterActivation.session.state.battleDamage).toEqual({ 0: 0, 1: 300 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const tensen = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === tensenCode);
  expect(tensen).toBeDefined();
  return [
    { ...tensen!, kind: "trap" },
    { code: beastWarriorCode, name: "Tensen Beast-Warrior Target", kind: "monster", typeFlags: typeMonster, race: raceBeastWarrior, attribute: attributeFire, level: 4, attack: 1800, defense: 1000 },
    { code: secondBeastWarriorCode, name: "Tensen Beast-Warrior Ally", kind: "monster", typeFlags: typeMonster, race: raceBeastWarrior, attribute: attributeFire, level: 4, attack: 1200, defense: 1000 },
    { code: warriorCode, name: "Tensen Warrior Non-Target", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1600, defense: 1000 },
    { code: defenderCode, name: "Tensen Defender", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeFire, level: 4, attack: 2500, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Fire Formation - Tensen");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_BEASTWARRIOR)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e1:SetValue(700)");
  expect(script).toContain("e2:SetRange(LOCATION_SZONE)");
  expect(script).toContain("e2:SetTargetRange(LOCATION_MZONE,0)");
  expect(script).toContain("e2:SetTarget(aux.TargetBoolFunction(Card.IsRace,RACE_BEASTWARRIOR))");
  expect(script).toContain("e2:SetValue(300)");
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

function moveSetSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
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

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passAttack" || candidate.type === "passDamage" || candidate.type === "passChain");
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
}
