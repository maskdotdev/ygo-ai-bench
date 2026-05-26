import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentCardCodes } from "#duel/card-code-state.js";
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
const soulCode = "79234734";
const discardCostCode = "792347340";
const beginningKnightCode = "6628343";
const eveningTwilightKnightCode = "32013448";
const offCodeSearchDecoyCode = "792347341";
const blackLusterSoldierCode = "5405694";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSoulScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${soulCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setBlackLusterSoldier = 0x10cf;
const raceWarrior = 0x1;
const raceSpellcaster = 0x2;
const attributeEarth = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;
const effectSetAttackFinal = 102;
const effectChangeCode = 114;
const effectFlagCannotDisable = 0x400;
const resetStandardPhaseEnd = 1107169792;
const resetStandardDisablePhaseEnd = 1107235328;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSoulScript)("Lua real script Super Soldier Soul discard code attack self-banish search stat", () => {
  it("restores discard-cost final ATK/code change and grave self-banish Knight search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectSoulScriptShape(workspace.readScript(`official/c${soulCode}.lua`));
    const soulData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === soulCode);
    expect(soulData).toBeDefined();
    const reader = createCardReader([
      soulData!,
      ...fixtureCards(),
    ]);

    const restoredStat = createRestoredStatWindow({ reader, workspace });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const statSoul = requireCard(restoredStat.session, soulCode);
    const discardCost = requireCard(restoredStat.session, discardCostCode);
    const stat = getLuaRestoreLegalActions(restoredStat, 0).find((action) => action.type === "activateEffect" && action.uid === statSoul.uid && action.effectId === "lua-1");
    expect(stat, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, stat!);
    resolveRestoredChain(restoredStat);

    expect(restoredStat.session.state.cards.find((card) => card.uid === discardCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: statSoul.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === statSoul.uid), restoredStat.session.state)).toBe(3000);
    expect(currentCardCodes(restoredStat.session.state.cards.find((card) => card.uid === statSoul.uid)!, restoredStat.session.state)).toEqual([blackLusterSoldierCode]);
    expect(restoredStat.session.state.effects.filter((effect) => effect.sourceUid === statSoul.uid && [effectSetAttackFinal, effectChangeCode].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", property: undefined, reset: { flags: resetStandardDisablePhaseEnd, count: 2 }, sourceUid: statSoul.uid, value: 3000 },
      { code: effectChangeCode, event: "continuous", property: effectFlagCannotDisable, reset: { flags: resetStandardPhaseEnd, count: 2 }, sourceUid: statSoul.uid, value: Number(blackLusterSoldierCode) },
    ]);
    expect(restoredStat.session.state.eventHistory.filter((event) => ["discarded", "sentToGraveyard", "chainSolved"].includes(event.eventName))).toEqual([
      sentToGraveEvent(discardCost.uid, statSoul.uid, 1, 0),
      chainSolvedEvent(1, "chain-3"),
    ]);

    const restoredGrave = createRestoredGraveSearchWindow({ reader, workspace });
    expectCleanRestore(restoredGrave);
    expectRestoredLegalActions(restoredGrave, 0);
    const graveSoul = requireCard(restoredGrave.session, soulCode);
    const beginningKnight = requireCard(restoredGrave.session, beginningKnightCode);
    const eveningKnight = requireCard(restoredGrave.session, eveningTwilightKnightCode);
    const search = getLuaRestoreLegalActions(restoredGrave, 0).find((action) => action.type === "activateEffect" && action.uid === graveSoul.uid && action.effectId === "lua-2");
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredGrave, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredGrave, search!);
    resolveRestoredChain(restoredGrave);

    expect(restoredGrave.session.state.cards.find((card) => card.uid === graveSoul.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveSoul.uid,
      reasonEffectId: 2,
    });
    expect(restoredGrave.session.state.cards.find((card) => card.uid === eveningKnight.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveSoul.uid,
      reasonEffectId: 2,
    });
    expect(restoredGrave.session.state.cards.find((card) => card.uid === beginningKnight.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredGrave.session.state.eventHistory.filter((event) => ["banished", "sentToHand", "confirmed", "sentToHandConfirmed", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: graveSoul.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: graveSoul.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
      },
      sentToHandEvent(eveningKnight.uid, graveSoul.uid, 2, 1),
      confirmedEvent(eveningKnight.uid, graveSoul.uid, 2, 1),
      sentToHandConfirmedEvent(eveningKnight.uid, graveSoul.uid, 2, 1),
      chainSolvedEvent(2, "chain-3"),
    ]);
    expect(restoredGrave.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredStatWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 79234734, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [soulCode, discardCostCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, soulCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, discardCostCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerSoul(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredGraveSearchWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 79234735, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [soulCode, beginningKnightCode, eveningTwilightKnightCode, offCodeSearchDecoyCode] }, 1: { main: [] } });
  startDuel(session);
  const soul = moveDuelCard(session.state, requireCard(session, soulCode).uid, "graveyard", 0);
  soul.faceUp = true;
  soul.position = "faceUpAttack";
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerSoul(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function fixtureCards(): DuelCardData[] {
  return [
    { code: discardCostCode, name: "Super Soldier Soul Black Luster Soldier Cost", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBlackLusterSoldier], race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: beginningKnightCode, name: "Beginning Knight", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 500, defense: 2000 },
    { code: eveningTwilightKnightCode, name: "Evening Twilight Knight", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 500, defense: 2000 },
    { code: offCodeSearchDecoyCode, name: "Super Soldier Soul Off-Code Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1400, defense: 1000 },
  ];
}

function registerSoul(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(soulCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectSoulScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Super Soldier Soul");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("Duel.DiscardHand(tp,s.atkcostfilter,1,1,REASON_COST)");
  expect(script).toContain("local ct=Duel.IsTurnPlayer(tp) and 2 or 1");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(3000)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END,ct)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_CHANGE_CODE)");
  expect(script).toContain("e2:SetValue(5405694)");
  expect(script).toContain("e2:SetReset(RESETS_STANDARD_PHASE_END,ct)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return c:IsCode(6628343,32013448) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function sentToGraveEvent(cardUid: string, sourceUid: string, reasonEffectId: number, previousSequence: number) {
  return {
    eventName: "sentToGraveyard",
    eventCode: 1014,
    eventCardUid: cardUid,
    eventReason: duelReason.cost,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: reasonEffectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
  };
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

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
