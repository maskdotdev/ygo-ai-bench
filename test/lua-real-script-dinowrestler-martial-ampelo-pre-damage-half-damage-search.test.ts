import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const ampeloCode = "54446813";
const dinowrestlerBattlerCode = "544468130";
const opponentBattlerCode = "544468131";
const searchTargetCode = "544468132";
const levelSpellDecoyCode = "544468133";
const offSetMonsterDecoyCode = "544468134";
const searchAttackTargetCode = "544468135";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasAmpeloScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ampeloCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceDinosaur = 0x10000;
const attributeEarth = 0x1;
const setDinowrestler = 0x11a;
const effectIndestructableBattle = 42;
const effectChangeBattleDamage = 208;
const effectFlagPlayerTarget = 0x800;
const halfDamage = 0x80000001;
const resetEventStandardPhaseDamage = 1107169312;
const resetPhaseDamage = 0x40000020;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasAmpeloScript)("Lua real script Dinowrestler Martial Ampelo pre-damage half damage search", () => {
  it("restores SelfToGrave battle protection, HALF_DAMAGE, and grave self-banish Dinowrestler search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ampeloCode}.lua`);
    expectAmpeloScriptShape(script);

    const ampeloData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === ampeloCode);
    expect(ampeloData).toBeDefined();
    const reader = createCardReader([
      ampeloData!,
      ...fixtureCards(),
    ]);

    const restoredPreDamage = createRestoredPreDamageWindow({ reader, workspace });
    expectCleanRestore(restoredPreDamage);
    expectRestoredLegalActions(restoredPreDamage, 0);
    const handAmpelo = requireCard(restoredPreDamage.session, ampeloCode);
    const ownBattler = requireCard(restoredPreDamage.session, dinowrestlerBattlerCode);
    const opponentBattler = requireCard(restoredPreDamage.session, opponentBattlerCode, 1);
    const attack = getLuaRestoreLegalActions(restoredPreDamage, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === ownBattler.uid && action.targetUid === opponentBattler.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, attack!);
    passUntilRestoredBattleWindow(restoredPreDamage, "beforeDamageCalculation");
    passUntilRestoredAction(restoredPreDamage, 0, handAmpelo.uid);

    const protection = getLuaRestoreLegalActions(restoredPreDamage, 0).find(
      (action) => action.type === "activateEffect" && action.uid === handAmpelo.uid && action.effectId === "lua-1-1134",
    );
    expect(protection, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, protection!);
    resolveRestoredChain(restoredPreDamage);
    expect(restoredPreDamage.session.state.cards.find((card) => card.uid === handAmpelo.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: handAmpelo.uid,
      reasonEffectId: 1,
    });
    expect(restoredPreDamage.session.state.effects.filter((effect) => [ownBattler.uid, handAmpelo.uid].includes(effect.sourceUid) && [effectIndestructableBattle, effectChangeBattleDamage].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      {
        code: effectIndestructableBattle,
        event: "continuous",
        property: undefined,
        range: ["monsterZone"],
        reset: { flags: resetEventStandardPhaseDamage },
        sourceUid: ownBattler.uid,
        targetRange: undefined,
        value: 1,
      },
      {
        code: effectChangeBattleDamage,
        event: "continuous",
        property: effectFlagPlayerTarget,
        range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"],
        reset: { flags: resetPhaseDamage },
        sourceUid: handAmpelo.uid,
        targetRange: [1, 0],
        value: halfDamage,
      },
    ]);
    expect(restoredPreDamage.session.state.eventHistory.filter((event) => ["beforeDamageCalculation", "sentToGraveyard", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventUids: event.eventUids,
      relatedEffectId: event.relatedEffectId,
      eventChainDepth: event.eventChainDepth,
    }))).toEqual([
      {
        eventName: "beforeDamageCalculation",
        eventCode: 1134,
        eventCardUid: ownBattler.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        eventPlayer: undefined,
        eventValue: undefined,
        eventUids: [ownBattler.uid, opponentBattler.uid],
        relatedEffectId: undefined,
        eventChainDepth: undefined,
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: handAmpelo.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: handAmpelo.uid,
        eventReasonEffectId: 1,
        eventPlayer: undefined,
        eventValue: undefined,
        eventUids: undefined,
        relatedEffectId: undefined,
        eventChainDepth: undefined,
      },
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventCardUid: undefined,
        eventReason: undefined,
        eventReasonPlayer: 0,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: undefined,
        relatedEffectId: 1,
        eventChainDepth: 1,
      },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredPreDamage.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    passRestoredBattle(restoredBattle);
    expect(restoredBattle.session.state.players[0].lifePoints).toBe(7750);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 250, 1: 0 });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === ownBattler.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === opponentBattler.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: opponentBattler.uid,
        eventPlayer: 0,
        eventValue: 250,
        eventReason: duelReason.battle,
        eventReasonCardUid: opponentBattler.uid,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredSearch = createRestoredSearchWindow({ reader, workspace });
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 1);
    const graveAmpelo = requireCard(restoredSearch.session, ampeloCode);
    const searchTarget = requireCard(restoredSearch.session, searchTargetCode);
    const spellDecoy = requireCard(restoredSearch.session, levelSpellDecoyCode);
    const offSetDecoy = requireCard(restoredSearch.session, offSetMonsterDecoyCode);
    const searchAttackTarget = requireCard(restoredSearch.session, searchAttackTargetCode);
    const searchAttacker = requireCard(restoredSearch.session, opponentBattlerCode, 1);
    const opponentAttack = getLuaRestoreLegalActions(restoredSearch, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === searchAttacker.uid && action.targetUid === searchAttackTarget.uid,
    );
    expect(opponentAttack, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, opponentAttack!);

    const restoredSearchTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSearch.session), workspace, reader);
    expectCleanRestore(restoredSearchTrigger);
    expectRestoredLegalActions(restoredSearchTrigger, 0);
    const search = getLuaRestoreLegalActions(restoredSearchTrigger, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === graveAmpelo.uid && action.effectId === "lua-2-1130",
    );
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredSearchTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearchTrigger, search!);
    expect(restoredSearchTrigger.session.state.chain).toEqual([]);
    expect(restoredSearchTrigger.session.state.cards.find((card) => card.uid === graveAmpelo.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveAmpelo.uid,
      reasonEffectId: 2,
    });
    expect(restoredSearchTrigger.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveAmpelo.uid,
      reasonEffectId: 2,
    });
    expect(restoredSearchTrigger.session.state.cards.find((card) => card.uid === spellDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearchTrigger.session.state.cards.find((card) => card.uid === offSetDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    const searchedPreviousSequence = restoredSearchTrigger.session.state.cards.find((card) => card.uid === searchTarget.uid)?.previousSequence ?? 0;
    expect(restoredSearchTrigger.session.state.eventHistory.filter((event) => ["attackDeclared", "banished", "sentToHand", "confirmed", "sentToHandConfirmed", "chainSolved"].includes(event.eventName))).toEqual([
      attackDeclaredEvent(searchAttacker.uid, searchAttackTarget.uid),
      banishedEvent(graveAmpelo.uid),
      sentToHandEvent(searchTarget.uid, graveAmpelo.uid, searchedPreviousSequence),
      confirmedEvent(searchTarget.uid, graveAmpelo.uid, searchedPreviousSequence),
      sentToHandConfirmedEvent(searchTarget.uid, graveAmpelo.uid, searchedPreviousSequence),
      chainSolvedEvent(2, "chain-4"),
    ]);
    expect(restoredSearchTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function fixtureCards(): DuelCardData[] {
  return [
    { code: dinowrestlerBattlerCode, name: "Ampelo Dinowrestler Battler", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDinowrestler], race: raceDinosaur, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
    { code: opponentBattlerCode, name: "Ampelo Opponent Battler", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeEarth, level: 4, attack: 2000, defense: 1000 },
    { code: searchTargetCode, name: "Ampelo Dinowrestler Search Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDinowrestler], race: raceDinosaur, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
    { code: levelSpellDecoyCode, name: "Ampelo Dinowrestler Spell Decoy", kind: "spell", typeFlags: typeSpell, setcodes: [setDinowrestler] },
    { code: offSetMonsterDecoyCode, name: "Ampelo Off-Set Monster Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [0x123], race: raceDinosaur, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: searchAttackTargetCode, name: "Ampelo Search Attack Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createRestoredPreDamageWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 54446813, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ampeloCode, dinowrestlerBattlerCode] }, 1: { main: [opponentBattlerCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, ampeloCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, dinowrestlerBattlerCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, opponentBattlerCode, 1), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ampeloCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredSearchWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 54446814, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ampeloCode, searchAttackTargetCode, searchTargetCode, levelSpellDecoyCode, offSetMonsterDecoyCode] }, 1: { main: [opponentBattlerCode] } });
  startDuel(session);
  const ampelo = moveDuelCard(session.state, requireCard(session, ampeloCode).uid, "graveyard", 0);
  ampelo.faceUp = true;
  ampelo.position = "faceUpAttack";
  moveFaceUpAttack(session, requireCard(session, searchAttackTargetCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, opponentBattlerCode, 1), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ampeloCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectAmpeloScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Dinowrestler Martial Ampelo");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND|LOCATION_MZONE)");
  expect(script).toContain("e1:SetCost(Cost.SelfToGrave)");
  expect(script).toContain("local a=Duel.GetAttacker()");
  expect(script).toContain("local b=a:GetBattleTarget()");
  expect(script).toContain("if a:IsControler(1-tp) then a,b=b,a end");
  expect(script).toContain("a:IsSetCard(SET_DINOWRESTLER) and a:IsRelateToBattle()");
  expect(script).toContain("Duel.GetAttackTarget()~=nil and dif>=0");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCode(EFFECT_CHANGE_BATTLE_DAMAGE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
  expect(script).toContain("e2:SetTargetRange(1,0)");
  expect(script).toContain("e2:SetValue(HALF_DAMAGE)");
  expect(script).toContain("e2:SetReset(RESET_PHASE|PHASE_DAMAGE)");
  expect(script).toContain("Duel.RegisterEffect(e2,tp)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return Duel.IsTurnPlayer(1-tp)");
  expect(script).toContain("return c:IsSetCard(SET_DINOWRESTLER) and c:IsMonster() and not c:IsCode(id) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function requireCard(session: DuelSession, code: string, controller?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.controller === controller));
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function attackDeclaredEvent(attackerUid: string, targetUid: string) {
  return {
    eventName: "attackDeclared",
    eventCode: 1130,
    eventCardUid: attackerUid,
    eventReason: 0,
    eventReasonPlayer: 1,
    eventUids: [attackerUid, targetUid],
    eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
  };
}

function banishedEvent(cardUid: string) {
  return {
    eventName: "banished",
    eventCode: 1011,
    eventCardUid: cardUid,
    eventReason: duelReason.cost,
    eventReasonPlayer: 0,
    eventReasonCardUid: cardUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
  };
}

function sentToHandEvent(cardUid: string, sourceUid: string, previousSequence: number) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string, previousSequence: number) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string, previousSequence: number) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
  };
}

function chainSolvedEvent(effectId: number, chainLinkId: string) {
  return {
    eventName: "chainSolved",
    eventCode: 1022,
    eventPlayer: 0,
    eventValue: 1,
    eventReasonPlayer: 0,
    relatedEffectId: effectId,
    eventChainDepth: 1,
    eventChainLinkId: chainLinkId,
  };
}

function passUntilRestoredBattleWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, kind: NonNullable<DuelSession["state"]["battleWindow"]>["kind"]): void {
  let guard = 0;
  while (restored.session.state.battleWindow?.kind !== kind) {
    expect(++guard).toBeLessThan(20);
    passRestoredBattleStep(restored);
  }
}

function passUntilRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, uid: string): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, player).some((action) => action.type === "activateEffect" && action.uid === uid)) {
    expect(++guard).toBeLessThan(20);
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattleStep(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
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
