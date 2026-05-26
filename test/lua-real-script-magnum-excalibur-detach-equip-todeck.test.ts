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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const magnumCode = "14301396";
const materialOneCode = "143013960";
const materialTwoCode = "143013961";
const equipTargetCode = "143013962";
const opponentCode = "143013963";
const warriorOneCode = "143013964";
const warriorTwoCode = "143013965";
const warriorThreeCode = "143013966";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts)("Lua real script Heroic Champion Magnum Excalibur detach equip toDeck", () => {
  it("restores Xyz material detach into damage-calculation final ATK doubling", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${magnumCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createMagnumSession(reader);
    const magnum = requireCard(session, magnumCode);
    const materialOne = requireCard(session, materialOneCode);
    const materialTwo = requireCard(session, materialTwoCode);
    const opponent = requireCard(session, opponentCode);
    moveFaceUpAttack(session, magnum, 0);
    moveFaceUpAttack(session, opponent, 1);
    attachOverlay(session, magnum, materialOne, materialTwo);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(magnumCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === magnum.uid && action.targetUid === opponent.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passRestoredBattleUntil(restoredBattle, () => findRestoredAction(restoredBattle, [1, 0], (action) => action.type === "activateEffect" && action.uid === magnum.uid) !== undefined);

    const restoredDamage = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredDamage);
    const damagePlayer = restoredDamage.session.state.waitingFor ?? restoredDamage.session.state.turnPlayer;
    expectRestoredLegalActions(restoredDamage, damagePlayer);
    const boost = findRestoredAction(restoredDamage, [1, 0], (action) => action.type === "activateEffect" && action.uid === magnum.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredDamage, damagePlayer), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamage, boost!);
    expect(restoredDamage.session.state.cards.find((card) => card.uid === materialOne.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: magnum.uid,
      reasonEffectId: 2,
    });
    expect(restoredDamage.session.state.cards.find((card) => card.uid === materialTwo.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: magnum.uid,
      reasonEffectId: 2,
    });
    expect(restoredDamage.session.state.cards.find((card) => card.uid === magnum.uid)?.overlayUids).toEqual([]);
    resolveRestoredChain(restoredDamage);
    expect(currentAttack(restoredDamage.session.state.cards.find((card) => card.uid === magnum.uid), restoredDamage.session.state)).toBe(4000);
    expect(restoredDamage.session.state.effects.filter((effect) => effect.sourceUid === magnum.uid && effect.code === 102).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 102, reset: { flags: 1107234880 }, value: 4000 }]);
  });

  it("restores Main Phase Quick equip into equip limit and +2000 ATK/DEF", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${magnumCode}.lua`));
    const reader = createCardReader(cards());
    const session = createMagnumSession(reader);
    const magnum = requireCard(session, magnumCode);
    const equipTarget = requireCard(session, equipTargetCode);
    moveFaceUpAttack(session, magnum, 0);
    moveFaceUpAttack(session, equipTarget, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(magnumCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const equip = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === magnum.uid);
    expect(equip, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, equip!);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === magnum.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: equipTarget.uid,
      cardTargetUids: [equipTarget.uid],
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: magnum.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === equipTarget.uid), restoredOpen.session.state)).toBe(3800);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === equipTarget.uid), restoredOpen.session.state)).toBe(3200);
    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, 0);
    expectLuaEquipProbe(restoredEquipped, "magnum equip probe 14301396/143013962/true/3800/3200");
    expect(restoredEquipped.host.messages).not.toContain("magnum responder resolved");
  });

  it("restores grave Cost.SelfBanish into selecting three Warriors and shuffling them into the Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${magnumCode}.lua`));
    const reader = createCardReader(cards());
    const session = createMagnumSession(reader);
    const magnum = requireCard(session, magnumCode);
    const warriorOne = requireCard(session, warriorOneCode);
    const warriorTwo = requireCard(session, warriorTwoCode);
    const warriorThree = requireCard(session, warriorThreeCode);
    moveDuelCard(session.state, magnum.uid, "graveyard", 0).turnId = 0;
    for (const warrior of [warriorOne, warriorTwo, warriorThree]) moveDuelCard(session.state, warrior.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(magnumCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const toDeck = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === magnum.uid);
    expect(toDeck, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, toDeck!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === magnum.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: magnum.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.chain).toEqual([]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    for (const warrior of [warriorOne, warriorTwo, warriorThree]) {
      expect(restoredChain.session.state.cards.find((card) => card.uid === warrior.uid)).toMatchObject({
        location: "deck",
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: magnum.uid,
        reasonEffectId: 4,
      });
    }
    const warriorUids = new Set([warriorOne.uid, warriorTwo.uid, warriorThree.uid]);
    expect(restoredChain.session.state.eventHistory.filter((event) =>
      event.eventName === "banished" || (event.eventName === "sentToDeck" && event.eventCardUid !== undefined && warriorUids.has(event.eventCardUid))
    ).map((event) => ({ eventName: event.eventName, eventCardUid: event.eventCardUid }))).toEqual([
      { eventName: "banished", eventCardUid: magnum.uid },
      { eventName: "sentToDeck", eventCardUid: warriorOne.uid },
      { eventName: "sentToDeck", eventCardUid: warriorTwo.uid },
      { eventName: "sentToDeck", eventCardUid: warriorThree.uid },
      { eventName: "sentToDeck", eventCardUid: warriorOne.uid },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_WARRIOR),4,2)");
  expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(2))");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e2:SetCategory(CATEGORY_EQUIP)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("Duel.IsMainPhase()");
  expect(script).toContain("Duel.Equip(tp,c,tc)");
  expect(script).toContain("e0:SetCode(EFFECT_EQUIP_LIMIT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("e3:SetCategory(CATEGORY_TODECK)");
  expect(script).toContain("e3:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,nil,3,tp,LOCATION_GRAVE)");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: magnumCode, name: "Heroic Champion - Magnum Excalibur", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, level: 4, attack: 2000, defense: 2000 },
    { code: materialOneCode, name: "Magnum Excalibur Material One", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    { code: materialTwoCode, name: "Magnum Excalibur Material Two", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    { code: equipTargetCode, name: "Magnum Excalibur Equip Target", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1800, defense: 1200 },
    { code: opponentCode, name: "Magnum Excalibur Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2500, defense: 1000 },
    { code: warriorOneCode, name: "Magnum Excalibur Warrior One", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    { code: warriorTwoCode, name: "Magnum Excalibur Warrior Two", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1100, defense: 1000 },
    { code: warriorThreeCode, name: "Magnum Excalibur Warrior Three", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1200, defense: 1000 },
  ];
}

function createMagnumSession(reader: ReturnType<typeof createCardReader>): DuelSession {
  const session = createDuel({ seed: 14301396, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [materialOneCode, materialTwoCode, equipTargetCode, warriorOneCode, warriorTwoCode, warriorThreeCode], extra: [magnumCode] },
    1: { main: [opponentCode] },
  });
  startDuel(session);
  return session;
}

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

function attachOverlay(session: DuelSession, holder: DuelCardInstance, ...materials: DuelCardInstance[]): void {
  for (const material of materials) {
    moveDuelCard(session.state, material.uid, "overlay", holder.controller, duelReason.material | duelReason.xyz, holder.controller);
    holder.overlayUids.push(material.uid);
  }
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

function findRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, players: PlayerId[], predicate: (action: DuelAction) => boolean): DuelAction | undefined {
  for (const player of players) {
    const action = getLuaRestoreLegalActions(restored, player).find(predicate);
    if (action) return action;
  }
  return undefined;
}

function passRestoredBattleUntil(restored: ReturnType<typeof restoreDuelWithLuaScripts>, done: () => boolean): void {
  let guard = 0;
  while (!done()) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    expectRestoredLegalActions(restored, player);
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function expectLuaEquipProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${equipTargetCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${magnumCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      local equipCode=equip and equip:GetCode() or "nil"
      local equipTarget=equip and equip:GetEquipTarget()
      local equipTargetCode=equipTarget and equipTarget:GetCode() or "nil"
      Debug.Message("magnum equip probe " .. equipCode .. "/" .. equipTargetCode .. "/" .. tostring(equip and equip:IsHasEffect(EFFECT_EQUIP_LIMIT)~=nil and equipTarget==target) .. "/" .. target:GetAttack() .. "/" .. target:GetDefense())
    `,
    "magnum-excalibur-equip-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
