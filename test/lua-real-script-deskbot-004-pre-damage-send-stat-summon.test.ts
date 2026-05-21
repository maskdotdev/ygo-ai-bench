import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const deskbot004Code = "22227683";
const deckDeskbotCode = "222276830";
const handDeskbotCode = "222276831";
const graveDeskbotCode = "222276832";
const defenderCode = "222276833";
const setDeskbot = 0xab;
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Deskbot 004 pre-damage send stat summon", () => {
  it("restores pre-damage Deck send stat boost, opponent battle-damage avoidance, and battle-destroying two-Deskbot summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${deskbot004Code}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoGrave(tc,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e3:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)");
    expect(script).toContain("e3:SetTargetRange(0,1)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYING)");
    expect(script).toContain("Duel.IsPlayerAffectedByEffect(tp,CARD_BLUEEYES_SPIRIT)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,2,tp,LOCATION_GRAVE|LOCATION_HAND)");
    expect(script).toContain("Duel.SpecialSummon(g1,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === deskbot004Code),
      { code: deckDeskbotCode, name: "Deskbot 004 Fixture Deck Send", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDeskbot], level: 5, attack: 500, defense: 500 },
      { code: handDeskbotCode, name: "Deskbot 004 Fixture Hand Summon", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDeskbot], level: 2, attack: 500, defense: 500 },
      { code: graveDeskbotCode, name: "Deskbot 004 Fixture Grave Summon", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDeskbot], level: 3, attack: 500, defense: 500 },
      { code: defenderCode, name: "Deskbot 004 Fixture Defender", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 22227683, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [deskbot004Code, deckDeskbotCode, handDeskbotCode, graveDeskbotCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const deskbot004 = requireCard(session, deskbot004Code);
    const deckDeskbot = requireCard(session, deckDeskbotCode);
    const handDeskbot = requireCard(session, handDeskbotCode);
    const graveDeskbot = requireCard(session, graveDeskbotCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, deskbot004.uid, "monsterZone", 0);
    deskbot004.faceUp = true;
    deskbot004.position = "faceUpAttack";
    moveDuelCard(session.state, handDeskbot.uid, "hand", 0);
    moveDuelCard(session.state, graveDeskbot.uid, "graveyard", 0);
    graveDeskbot.faceUp = true;
    moveDuelCard(session.state, defender.uid, "monsterZone", 1);
    defender.faceUp = true;
    defender.position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(deskbot004Code), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === deskbot004.uid && action.targetUid === defender.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, attack!);
    passRestoredBattleUntil(restoredOpen, () => findRestoredAction(restoredOpen, [1, 0], (action) => action.type === "activateEffect" && action.uid === deskbot004.uid) !== undefined);

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredPreDamage);
    const preDamagePlayer = restoredPreDamage.session.state.waitingFor ?? restoredPreDamage.session.state.turnPlayer;
    expectRestoredLegalActions(restoredPreDamage, preDamagePlayer);
    const quick = findRestoredAction(restoredPreDamage, [1, 0], (action) => action.type === "activateEffect" && action.uid === deskbot004.uid);
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, preDamagePlayer), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPreDamage, quick!);
    expect(restoredPreDamage.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    const restoredQuickChain = restoreDuelWithLuaScripts(serializeDuel(restoredPreDamage.session), workspace, reader);
    expectCleanRestore(restoredQuickChain);
    expectRestoredLegalActions(restoredQuickChain, restoredQuickChain.session.state.waitingFor ?? restoredQuickChain.session.state.turnPlayer);
    expect(restoredQuickChain.session.state.cards.find((card) => card.uid === deckDeskbot.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: deskbot004.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredQuickChain.session.state.cards.find((card) => card.uid === deskbot004.uid), restoredQuickChain.session.state)).toBe(3000);
    expect(currentDefense(restoredQuickChain.session.state.cards.find((card) => card.uid === deskbot004.uid), restoredQuickChain.session.state)).toBe(3000);
    expect(restoredQuickChain.session.state.effects.filter((effect) => effect.sourceUid === deskbot004.uid && [100, 104, 201].includes(effect.code ?? 0)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", property: undefined, range: ["monsterZone"], reset: { flags: 1107169344 }, targetRange: undefined, value: 2500 },
      { code: 104, event: "continuous", property: undefined, range: ["monsterZone"], reset: { flags: 1107169344 }, targetRange: undefined, value: 2500 },
      { code: 201, event: "continuous", property: 0x4000800, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], reset: { flags: 1073742336 }, targetRange: [0, 1], value: 1 },
    ]);
    expect(restoredQuickChain.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === deckDeskbot.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: deckDeskbot.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: deskbot004.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
    ]);

    passRestoredBattleUntil(restoredQuickChain, () => restoredQuickChain.session.state.pendingTriggers.some((trigger) => trigger.effectId === "lua-2-1139"));
    expect(restoredQuickChain.session.state.players[1]!.lifePoints).toBe(8000);
    expect(restoredQuickChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredQuickChain.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: deskbot004.uid,
    });

    const restoredBattleDestroying = restoreDuelWithLuaScripts(serializeDuel(restoredQuickChain.session), workspace, reader);
    expectCleanRestore(restoredBattleDestroying);
    expectRestoredLegalActions(restoredBattleDestroying, 0);
    const summonTrigger = getLuaRestoreLegalActions(restoredBattleDestroying, 0).find((action) => action.type === "activateTrigger" && action.uid === deskbot004.uid);
    expect(summonTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattleDestroying, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattleDestroying, summonTrigger!);
    expect(restoredBattleDestroying.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    const restoredSummonChain = restoreDuelWithLuaScripts(serializeDuel(restoredBattleDestroying.session), workspace, reader);
    expectCleanRestore(restoredSummonChain);
    expectRestoredLegalActions(restoredSummonChain, restoredSummonChain.session.state.waitingFor ?? restoredSummonChain.session.state.turnPlayer);
    expect(restoredSummonChain.session.state.cards.find((card) => card.uid === handDeskbot.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: deskbot004.uid,
      reasonEffectId: 2,
    });
    expect(restoredSummonChain.session.state.cards.find((card) => card.uid === graveDeskbot.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: deskbot004.uid,
      reasonEffectId: 2,
    });
    expect(restoredSummonChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: handDeskbot.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: deskbot004.uid,
        eventReasonEffectId: 2,
        eventUids: [handDeskbot.uid, graveDeskbot.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 1 },
      },
    ]);
  });
});

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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function findRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, players: PlayerId[], predicate: (action: DuelAction) => boolean): DuelAction | undefined {
  for (const player of players) {
    const action = getLuaRestoreLegalActions(restored, player).find(predicate);
    if (action) return action;
  }
  return undefined;
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor;
  expect(player).toBeDefined();
  const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
}

function passRestoredBattleUntil(restored: ReturnType<typeof restoreDuelWithLuaScripts>, done: () => boolean): void {
  let guard = 0;
  while (!done()) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
