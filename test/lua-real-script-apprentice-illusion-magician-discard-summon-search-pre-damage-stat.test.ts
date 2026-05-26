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
const apprenticeCode = "30603688";
const darkMagicianCode = "46986414";
const discardCostCode = "306036880";
const darkSpellcasterCode = "306036881";
const lightSpellcasterDecoyCode = "306036882";
const opponentCode = "306036883";
const offCodeSearchDecoy = "306036884";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasApprenticeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${apprenticeCode}.lua`));
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeEffect = 0x20;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;
const resetEventStandardPhaseDamageCalculation = 1107169344;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasApprenticeScript)("Lua real script Apprentice Illusion Magician discard summon search pre-damage stat", () => {
  it("restores discard Special Summon procedure, summon Dark Magician search, and pre-damage Spellcaster stat boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${apprenticeCode}.lua`);
    expectApprenticeScriptShape(script);

    const apprenticeData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === apprenticeCode);
    expect(apprenticeData).toBeDefined();
    const reader = createCardReader([
      apprenticeData!,
      ...fixtureCards(),
    ]);

    const restoredProcedure = createRestoredProcedureWindow({ reader, workspace });
    expectCleanRestore(restoredProcedure);
    expectRestoredLegalActions(restoredProcedure, 0);
    const procedureApprentice = requireCard(restoredProcedure.session, apprenticeCode);
    const discardCost = requireCard(restoredProcedure.session, discardCostCode);
    const darkMagician = requireCard(restoredProcedure.session, darkMagicianCode);
    const offCodeDecoy = requireCard(restoredProcedure.session, offCodeSearchDecoy);
    const procedure = getLuaRestoreLegalActions(restoredProcedure, 0).find(
      (action) => action.type === "specialSummonProcedure" && action.uid === procedureApprentice.uid,
    );
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedure, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProcedure, procedure!);
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === procedureApprentice.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === discardCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: procedureApprentice.uid,
      reasonEffectId: 1,
    });
    expect(restoredProcedure.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: discardCost.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: procedureApprentice.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: procedureApprentice.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
      },
    ]);

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredProcedure.session), workspace, reader);
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    const search = getLuaRestoreLegalActions(restoredSummonTrigger, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === procedureApprentice.uid && action.effectId === "lua-3-1102",
    );
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredSummonTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonTrigger, search!);
    expect(restoredSummonTrigger.session.state.chain).toEqual([]);
    expect(restoredSummonTrigger.session.state.cards.find((card) => card.uid === darkMagician.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: procedureApprentice.uid,
      reasonEffectId: 3,
    });
    expect(restoredSummonTrigger.session.state.cards.find((card) => card.uid === offCodeDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    const searchedPreviousSequence = restoredSummonTrigger.session.state.cards.find((card) => card.uid === darkMagician.uid)?.previousSequence ?? 0;
    expect(restoredSummonTrigger.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed", "chainSolved"].includes(event.eventName))).toEqual([
      sentToHandEvent(darkMagician.uid, procedureApprentice.uid, 3, searchedPreviousSequence),
      confirmedEvent(darkMagician.uid, procedureApprentice.uid, 3, searchedPreviousSequence),
      sentToHandConfirmedEvent(darkMagician.uid, procedureApprentice.uid, 3, searchedPreviousSequence),
      chainSolvedEvent(3, "chain-5"),
    ]);

    const restoredPreDamage = createRestoredPreDamageWindow({ reader, workspace });
    expectCleanRestore(restoredPreDamage);
    expectRestoredLegalActions(restoredPreDamage, 0);
    const statApprentice = requireCard(restoredPreDamage.session, apprenticeCode);
    const darkSpellcaster = requireCard(restoredPreDamage.session, darkSpellcasterCode);
    const lightDecoy = requireCard(restoredPreDamage.session, lightSpellcasterDecoyCode);
    const opponent = requireCard(restoredPreDamage.session, opponentCode, 1);
    const attack = getLuaRestoreLegalActions(restoredPreDamage, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === darkSpellcaster.uid && action.targetUid === opponent.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, attack!);
    passUntilRestoredAction(restoredPreDamage, 0, statApprentice.uid);
    const boost = getLuaRestoreLegalActions(restoredPreDamage, 0).find(
      (action) => action.type === "activateEffect" && action.uid === statApprentice.uid && action.effectId === "lua-4-1134",
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, boost!);
    resolveRestoredChain(restoredPreDamage);
    expect(restoredPreDamage.session.state.cards.find((card) => card.uid === statApprentice.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: statApprentice.uid,
      reasonEffectId: 4,
    });
    expect(currentAttack(restoredPreDamage.session.state.cards.find((card) => card.uid === darkSpellcaster.uid), restoredPreDamage.session.state)).toBe(3000);
    expect(currentDefense(restoredPreDamage.session.state.cards.find((card) => card.uid === darkSpellcaster.uid), restoredPreDamage.session.state)).toBe(2900);
    expect(currentAttack(restoredPreDamage.session.state.cards.find((card) => card.uid === lightDecoy.uid), restoredPreDamage.session.state)).toBe(1000);
    expect(restoredPreDamage.session.state.effects.filter((effect) => effect.sourceUid === darkSpellcaster.uid && [effectUpdateAttack, effectUpdateDefense].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", range: ["monsterZone"], reset: { flags: resetEventStandardPhaseDamageCalculation }, sourceUid: darkSpellcaster.uid, value: 2000 },
      { code: effectUpdateDefense, event: "continuous", range: ["monsterZone"], reset: { flags: resetEventStandardPhaseDamageCalculation }, sourceUid: darkSpellcaster.uid, value: 2000 },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredPreDamage.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    passRestoredBattle(restoredBattle);
    expect(restoredBattle.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(6500);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 1500 });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === darkSpellcaster.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonCardUid: darkSpellcaster.uid,
      reasonPlayer: 0,
    });
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: darkSpellcaster.uid,
        eventPlayer: 1,
        eventValue: 1500,
        eventReason: duelReason.battle,
        eventReasonCardUid: darkSpellcaster.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function fixtureCards(): DuelCardData[] {
  return [
    { code: darkMagicianCode, name: "Dark Magician", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceSpellcaster, attribute: attributeDark, level: 7, attack: 2500, defense: 2100 },
    { code: discardCostCode, name: "Apprentice Illusion Discard Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: darkSpellcasterCode, name: "Apprentice Illusion DARK Spellcaster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1000, defense: 900 },
    { code: lightSpellcasterDecoyCode, name: "Apprentice Illusion LIGHT Spellcaster Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1000, defense: 900 },
    { code: opponentCode, name: "Apprentice Illusion Battle Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1500, defense: 1000 },
    { code: offCodeSearchDecoy, name: "Apprentice Illusion Off-Code Search Decoy", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceSpellcaster, attribute: attributeDark, level: 7, attack: 2400, defense: 2100 },
  ];
}

function createRestoredProcedureWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 30603688, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [apprenticeCode, discardCostCode, darkMagicianCode, offCodeSearchDecoy] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, apprenticeCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, discardCostCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(apprenticeCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredPreDamageWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 30603689, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [apprenticeCode, darkSpellcasterCode, lightSpellcasterDecoyCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, apprenticeCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, darkSpellcasterCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, lightSpellcasterDecoyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentCode, 1), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(apprenticeCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectApprenticeScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Apprentice Illusion Magician");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_UNCOPYABLE)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsDiscardable,tp,LOCATION_HAND,0,e:GetHandler())");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,1,1,aux.ChkfMMZ(1),0,c)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,1,1,aux.ChkfMMZ(1),1,tp,HINTMSG_DISCARD,nil,nil,true)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_DISCARD|REASON_COST)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsCode(CARD_DARK_MAGICIAN) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e4:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e4:SetRange(LOCATION_HAND|LOCATION_MZONE)");
  expect(script).toContain("e4:SetCost(Cost.SelfToGrave)");
  expect(script).toContain("return c and c~=e:GetHandler() and c:IsRace(RACE_SPELLCASTER)");
  expect(script).toContain("and c:IsAttribute(ATTRIBUTE_DARK) and c:IsRelateToBattle()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_DAMAGE_CAL)");
  expect(script).toContain("e1:SetValue(2000)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
}

function sentToHandEvent(cardUid: string, sourceUid: string, reasonEffectId: number, previousSequence: number) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string, reasonEffectId: number, previousSequence: number) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string, reasonEffectId: number, previousSequence: number) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: reasonEffectId,
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
