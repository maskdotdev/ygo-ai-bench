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
const morganaCode = "29439831";
const morganiteSearchCode = "294398310";
const morganiteGraveACode = "294398311";
const morganiteGraveBCode = "294398312";
const morganiteCostCode = "294398313";
const opponentStatACode = "294398314";
const opponentStatBCode = "294398315";
const opponentAttackerCode = "294398316";
const offSetSpellCode = "294398317";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasMorganaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${morganaCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const setMorganite = 0x1b3;
const effectSetAttackFinal = 102;
const effectFlagCannotDisable = 0x400;
const resetEventStandard = 0x1fe1000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasMorganaScript)("Lua real script Morgana the Witch of Eyes search negate final stat", () => {
  it("restores summon Morganite search, attack negation cost, and three-Morganite final ATK zeroing", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${morganaCode}.lua`);
    expect(script).toContain("Morgana the Witch of Eyes");
    expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("return Duel.GetAttacker():IsControler(1-tp)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.negatkcostfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
    expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
    expect(script).toContain("Duel.NegateAttack()");
    expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return c:IsSetCard(SET_MORGANITE) and c:IsSpell() and c:IsAbleToHand()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
    expect(script).toContain("local g=Duel.GetMatchingGroup(s.morganitefilter,tp,LOCATION_GRAVE|LOCATION_REMOVED,0,nil)");
    expect(script).toContain("return g:GetClassCount(Card.GetCode)>=3");
    expect(script).toContain("Duel.GetMatchingGroup(Card.HasNonZeroAttack,tp,0,LOCATION_MZONE,nil)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");

    const morganaData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === morganaCode);
    expect(morganaData).toBeDefined();
    const reader = createCardReader([
      morganaData!,
      ...fixtureCards(),
    ]);

    const restoredOpen = createRestoredNormalSummonWindow({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summonMorgana = requireCard(restoredOpen.session, morganaCode);
    const searchTarget = requireCard(restoredOpen.session, morganiteSearchCode);
    const normalSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === summonMorgana.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, normalSummon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        player: 0,
        sourceUid: summonMorgana.uid,
        effectId: "lua-2-1100",
        eventName: "normalSummoned",
        triggerBucket: "turnOptional",
        eventTriggerTiming: "if",
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventCode: 1100,
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCardUid: summonMorgana.uid,
      },
    ]);
    const searchTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === summonMorgana.uid && action.effectId === "lua-2-1100",
    );
    expect(searchTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, searchTrigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    const searchedTarget = restoredTrigger.session.state.cards.find((card) => card.uid === searchTarget.uid);
    expect(searchedTarget).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: summonMorgana.uid,
      reasonEffectId: 2,
    });
    const searchedPreviousSequence = searchedTarget?.previousSequence ?? 0;
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      normalSummonedEvent(summonMorgana.uid),
      sentToHandEvent(searchTarget.uid, summonMorgana.uid, 2, searchedPreviousSequence),
      confirmedEvent(searchTarget.uid, summonMorgana.uid, 2, searchedPreviousSequence),
      sentToHandConfirmedEvent(searchTarget.uid, summonMorgana.uid, 2, searchedPreviousSequence),
    ]);

    const restoredAttack = createRestoredAttackNegateWindow({ reader, workspace });
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 1);
    const attackMorgana = requireCard(restoredAttack.session, morganaCode);
    const costSpell = requireCard(restoredAttack.session, morganiteCostCode);
    const attacker = requireCard(restoredAttack.session, opponentAttackerCode, 1);
    const attack = getLuaRestoreLegalActions(restoredAttack, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === attackMorgana.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, attack!);

    const restoredAttackTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredAttack.session), workspace, reader);
    expectCleanRestore(restoredAttackTrigger);
    expectRestoredLegalActions(restoredAttackTrigger, 0);
    expect(restoredAttackTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        player: 0,
        sourceUid: attackMorgana.uid,
        effectId: "lua-1-1130",
        eventName: "attackDeclared",
        triggerBucket: "opponentOptional",
        eventTriggerTiming: "when",
        eventReason: 0,
        eventReasonPlayer: 1,
        eventCode: 1130,
        eventPlayer: 1,
        eventUids: [attacker.uid, attackMorgana.uid],
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCardUid: attacker.uid,
      },
    ]);
    const negate = getLuaRestoreLegalActions(restoredAttackTrigger, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === attackMorgana.uid && action.effectId === "lua-1-1130",
    );
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredAttackTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttackTrigger, negate!);
    expect(restoredAttackTrigger.session.state.pendingBattle).toBeUndefined();
    expect(restoredAttackTrigger.session.state.cards.find((card) => card.uid === costSpell.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: attackMorgana.uid,
      reasonEffectId: 1,
    });
    expect(restoredAttackTrigger.session.state.eventHistory.filter((event) => ["attackDeclared", "banished", "attackDisabled"].includes(event.eventName))).toEqual([
      attackDeclaredEvent(attacker.uid, attackMorgana.uid),
      costBanishedEvent(costSpell.uid, attackMorgana.uid),
      attackDisabledEvent(attacker.uid, attackMorgana.uid),
    ]);

    const restoredStat = createRestoredStatWindow({ reader, workspace });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const statMorgana = requireCard(restoredStat.session, morganaCode);
    const opponentA = requireCard(restoredStat.session, opponentStatACode, 1);
    const opponentB = requireCard(restoredStat.session, opponentStatBCode, 1);
    const statAction = getLuaRestoreLegalActions(restoredStat, 0).find(
      (action) => action.type === "activateEffect" && action.uid === statMorgana.uid && action.effectId === "lua-4",
    );
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, statAction!);
    expect(restoredStat.session.state.chain).toEqual([]);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === opponentA.uid), restoredStat.session.state)).toBe(0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === opponentB.uid), restoredStat.session.state)).toBe(0);
    expect(restoredStat.session.state.effects.filter((effect) => [opponentA.uid, opponentB.uid].includes(effect.sourceUid) && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: effectFlagCannotDisable, reset: { flags: resetEventStandard }, sourceUid: opponentA.uid, value: 0 },
      { code: effectSetAttackFinal, property: effectFlagCannotDisable, reset: { flags: resetEventStandard }, sourceUid: opponentB.uid, value: 0 },
    ]);
    expect(restoredStat.session.state.eventHistory.filter((event) => event.eventName === "chainSolved")).toEqual([
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        relatedEffectId: 4,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function fixtureCards(): DuelCardData[] {
  return [
    { code: morganiteSearchCode, name: "Morgana Morganite Search Spell", kind: "spell", typeFlags: typeSpell, setcodes: [setMorganite] },
    { code: morganiteGraveACode, name: "Morgana Morganite Grave A", kind: "spell", typeFlags: typeSpell, setcodes: [setMorganite] },
    { code: morganiteGraveBCode, name: "Morgana Morganite Grave B", kind: "spell", typeFlags: typeSpell, setcodes: [setMorganite] },
    { code: morganiteCostCode, name: "Morgana Morganite Cost Spell", kind: "spell", typeFlags: typeSpell, setcodes: [setMorganite] },
    { code: opponentStatACode, name: "Morgana Opponent Stat A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2000, defense: 1000 },
    { code: opponentStatBCode, name: "Morgana Opponent Stat B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
    { code: opponentAttackerCode, name: "Morgana Opponent Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: offSetSpellCode, name: "Morgana Off-Set Spell", kind: "spell", typeFlags: typeSpell, setcodes: [0x123] },
  ];
}

function createRestoredNormalSummonWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 29439831, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [morganaCode, morganiteSearchCode, offSetSpellCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, morganaCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(morganaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredAttackNegateWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 29439832, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [morganaCode, morganiteCostCode] }, 1: { main: [opponentAttackerCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, morganaCode), 0, 0);
  const cost = moveDuelCard(session.state, requireCard(session, morganiteCostCode).uid, "graveyard", 0);
  cost.faceUp = true;
  moveFaceUpAttack(session, requireCard(session, opponentAttackerCode, 1), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(morganaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredStatWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 29439833, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [morganaCode, morganiteSearchCode, morganiteGraveACode, morganiteGraveBCode] }, 1: { main: [opponentStatACode, opponentStatBCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, morganaCode), 0, 0);
  for (const code of [morganiteSearchCode, morganiteGraveACode]) {
    const grave = moveDuelCard(session.state, requireCard(session, code).uid, "graveyard", 0);
    grave.faceUp = true;
  }
  const banished = moveDuelCard(session.state, requireCard(session, morganiteGraveBCode).uid, "banished", 0);
  banished.faceUp = true;
  moveFaceUpAttack(session, requireCard(session, opponentStatACode, 1), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentStatBCode, 1), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(morganaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
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

function normalSummonedEvent(cardUid: string) {
  return {
    eventName: "normalSummoned",
    eventCode: 1100,
    eventReason: duelReason.summon,
    eventReasonPlayer: 0,
    eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCardUid: cardUid,
  };
}

function sentToHandEvent(cardUid: string, sourceUid: string, effectId: number, previousSequence: number) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventCardUid: cardUid,
  };
}

function confirmedEvent(cardUid: string, sourceUid: string, effectId: number, previousSequence: number) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventCardUid: cardUid,
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string, effectId: number, previousSequence: number) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: effectId,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: previousSequence },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventCardUid: cardUid,
  };
}

function attackDeclaredEvent(cardUid: string, targetUid: string) {
  return {
    eventName: "attackDeclared",
    eventCode: 1130,
    eventReason: 0,
    eventReasonPlayer: 1,
    eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCardUid: cardUid,
    eventUids: [cardUid, targetUid],
  };
}

function costBanishedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "banished",
    eventCode: 1011,
    eventReason: duelReason.cost,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
    eventCardUid: cardUid,
  };
}

function attackDisabledEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "attackDisabled",
    eventCode: 1142,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventPlayer: 1,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventCardUid: cardUid,
  };
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
