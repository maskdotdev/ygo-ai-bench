import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const borrowingCode = "33609093";
const opponentCode = "336090930";
const ancientWarriorCode = "336090931";
const ancientWarriorEarthCode = "336090932";
const placedSagaCode = "336090933";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasBorrowingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${borrowingCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeContinuous = 0x10000;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const attributeEarth = 0x1;
const setAncientWarriors = 0x137;
const effectSetAttackFinal = 102;
const effectUpdateAttack = 100;
const effectFlagCannotDisable = 0x400;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasBorrowingScript)("Lua real script Ancient Warriors Borrowing of Arrows target place stat", () => {
  it("restores S/T ignition dual targets into opponent ATK halve and Ancient Warriors ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${borrowingCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 33609093, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [borrowingCode, ancientWarriorCode, ancientWarriorEarthCode, placedSagaCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const borrowing = requireCard(session, borrowingCode);
    const opponent = requireCard(session, opponentCode);
    const ancientWarrior = requireCard(session, ancientWarriorCode);
    const ancientWarriorEarth = requireCard(session, ancientWarriorEarthCode);
    const placedSaga = requireCard(session, placedSagaCode);
    moveFaceUpSpellTrap(session, borrowing, 0, 0);
    moveFaceUpAttack(session, ancientWarrior, 0, 0);
    moveFaceUpAttack(session, ancientWarriorEarth, 0, 1);
    moveFaceUpAttack(session, opponent, 1, 0);
    moveDuelCard(session.state, placedSaga.uid, "deck", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(borrowingCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === borrowing.uid && action.effectId === "lua-2"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    resolveRestoredChain(restoredOpen);

    expect(currentAttack(findCard(restoredOpen.session, opponent.uid), restoredOpen.session.state)).toBe(1400);
    expect(currentAttack(findCard(restoredOpen.session, ancientWarrior.uid), restoredOpen.session.state)).toBe(3200);
    expect(currentAttack(findCard(restoredOpen.session, ancientWarriorEarth.uid), restoredOpen.session.state)).toBe(900);
    expect(restoredOpen.session.state.effects.filter((effect) =>
      [opponent.uid, ancientWarrior.uid].includes(effect.sourceUid) && [effectSetAttackFinal, effectUpdateAttack].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    })).sort((left, right) => (left.code ?? -1) - (right.code ?? -1))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: effectFlagCannotDisable, reset: { flags: resetStandardPhaseEnd }, sourceUid: ancientWarrior.uid, value: 1400 },
      { code: effectSetAttackFinal, event: "continuous", property: undefined, reset: { flags: resetStandardPhaseEnd }, sourceUid: opponent.uid, value: 1400 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: opponent.uid, eventCode: 1028, eventName: "becameTarget", relatedEffectId: 2 },
      { eventCardUid: ancientWarrior.uid, eventCode: 1028, eventName: "becameTarget", relatedEffectId: 2 },
    ]);

    const restoredAfterStat = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredAfterStat);
    expectRestoredLegalActions(restoredAfterStat, 0);
    expect(currentAttack(findCard(restoredAfterStat.session, opponent.uid), restoredAfterStat.session.state)).toBe(1400);
    expect(currentAttack(findCard(restoredAfterStat.session, ancientWarrior.uid), restoredAfterStat.session.state)).toBe(3200);
    restoredAfterStat.session.state.phase = "battle";
    restoredAfterStat.session.state.turnPlayer = 0;
    restoredAfterStat.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredAfterStat, 0);
    const attack = getLuaRestoreLegalActions(restoredAfterStat, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === ancientWarrior.uid && action.targetUid === opponent.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredAfterStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAfterStat, attack!);
    passRestoredBattle(restoredAfterStat);
    expect(restoredAfterStat.session.state.battleDamage).toEqual({ 0: 0, 1: 1800 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const borrowing = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === borrowingCode);
  expect(borrowing).toBeDefined();
  return [
    { ...borrowing!, kind: "spell" },
    { code: opponentCode, name: "Borrowing of Arrows Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 2800, defense: 1000 },
    { code: ancientWarriorCode, name: "Borrowing of Arrows Ancient Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1800, defense: 1000, setcodes: [setAncientWarriors] },
    { code: ancientWarriorEarthCode, name: "Borrowing of Arrows Ancient Warrior Earth", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 900, defense: 1000, setcodes: [setAncientWarriors] },
    { code: placedSagaCode, name: "Borrowing of Arrows Place Target", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setAncientWarriors] },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Ancient Warriors Saga - Borrowing of Arrows");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetRange(LOCATION_SZONE)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e:SetLabelObject(g:GetFirst())");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsSetCard,SET_ANCIENT_WARRIORS),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("local g=Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(math.ceil(atk/2))");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("return Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_ANCIENT_WARRIORS),tp,LOCATION_MZONE,0,nil):GetClassCount(Card.GetAttribute)>1");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK|LOCATION_HAND,0,1,1,nil,tp):GetFirst()");
  expect(script).toContain("Duel.MoveToField(tc,tp,tp,LOCATION_SZONE,POS_FACEUP,true)");
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

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
