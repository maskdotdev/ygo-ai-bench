import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
const chariotCode = "34568403";
const battleTargetCode = "345684030";
const hasChariotScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chariotCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryCoin = 0x1000000;
const categorySpecialSummon = 0x200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasChariotScript)("Lua real script Arcana Force Chariot coin battle summon", () => {
  it("restores summon TossCoin registration into heads battle-destroying Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${chariotCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [chariotCode] }, 1: { main: [battleTargetCode] } });
    startDuel(session);

    const chariot = requireCard(session, chariotCode);
    const battleTarget = requireCard(session, battleTargetCode);
    moveDuelCard(session.state, chariot.uid, "hand", 0);
    moveDuelCard(session.state, battleTarget.uid, "monsterZone", 1);
    battleTarget.faceUp = true;
    battleTarget.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(chariotCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === chariot.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryCoin, code: 1100, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "normalSummoned" },
      { category: categoryCoin, code: 1102, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned" },
      { category: categoryCoin, code: 1101, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "flipSummoned" },
    ]);

    const normalSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === chariot.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestored(restoredOpen, normalSummon!);

    const restoredCoinTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredCoinTrigger);
    expectRestoredLegalActions(restoredCoinTrigger, 0);
    expect(restoredCoinTrigger.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-1-1100",
        sourceUid: chariot.uid,
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: chariot.uid,
        eventPlayer: 0,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);
    const coinTrigger = getLuaRestoreLegalActions(restoredCoinTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === chariot.uid);
    expect(coinTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredCoinTrigger, 0), null, 2)).toBeDefined();
    applyRestored(restoredCoinTrigger, coinTrigger!);
    passRestoredChain(restoredCoinTrigger);

    expect(restoredCoinTrigger.session.state.lastCoinResults).toEqual([1]);
    expect(restoredCoinTrigger.session.state.effects.filter((effect) => effect.sourceUid === chariot.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryCoin, code: 1100, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "normalSummoned" },
      { category: categoryCoin, code: 1102, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned" },
      { category: categoryCoin, code: 1101, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "flipSummoned" },
      { category: categorySpecialSummon, code: 1139, event: "trigger", range: ["monsterZone"], triggerEvent: "battleDestroyed" },
      { category: undefined, code: 1040, event: "continuous", range: ["monsterZone"], triggerEvent: undefined },
    ]);

    restoredCoinTrigger.session.state.phase = "battle";
    restoredCoinTrigger.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredCoinTrigger, 0).find((action) => action.type === "declareAttack" && action.attackerUid === chariot.uid && action.targetUid === battleTarget.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredCoinTrigger, 0), null, 2)).toBeDefined();
    applyRestored(restoredCoinTrigger, attack!);
    passRestoredBattleResponses(restoredCoinTrigger);

    expect(restoredCoinTrigger.session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: chariot.uid,
    });

    const restoredBattleTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredCoinTrigger.session), workspace, reader);
    expectCleanRestore(restoredBattleTrigger);
    expectRestoredLegalActions(restoredBattleTrigger, 0);
    expect(restoredBattleTrigger.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-4-1139",
        sourceUid: chariot.uid,
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: chariot.uid,
        eventPlayer: 1,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: chariot.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        triggerBucket: "turnOptional",
      },
    ]);
    const summonTrigger = getLuaRestoreLegalActions(restoredBattleTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === chariot.uid);
    expect(summonTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattleTrigger, 0), null, 2)).toBeDefined();
    applyRestored(restoredBattleTrigger, summonTrigger!);
    passRestoredChain(restoredBattleTrigger);

    expect(restoredBattleTrigger.session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: chariot.uid,
      reasonEffectId: 4,
    });
    expect(restoredBattleTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "coinTossed", "battleDestroyed", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: chariot.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: chariot.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: battleTarget.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: chariot.uid,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: battleTarget.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: chariot.uid,
        eventReasonEffectId: 4,
        eventUids: [battleTarget.uid],
        eventPreviousState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
  });

  it("restores tails EVENT_ADJUST registration into opponent control transfer", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${chariotCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 1, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [chariotCode] }, 1: { main: [] } });
    startDuel(session);

    const chariot = requireCard(session, chariotCode);
    moveDuelCard(session.state, chariot.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(chariotCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const normalSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === chariot.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestored(restoredOpen, normalSummon!);

    const restoredCoinTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredCoinTrigger);
    expectRestoredLegalActions(restoredCoinTrigger, 0);
    const coinTrigger = getLuaRestoreLegalActions(restoredCoinTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === chariot.uid);
    expect(coinTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredCoinTrigger, 0), null, 2)).toBeDefined();
    applyRestored(restoredCoinTrigger, coinTrigger!);
    passRestoredChain(restoredCoinTrigger);

    expect(restoredCoinTrigger.session.state.lastCoinResults).toEqual([0]);
    const adjust = restoredCoinTrigger.host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${chariotCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Duel.AdjustInstantly(c)
      `,
      "arcana-force-chariot-adjust.lua",
    );
    expect(adjust.ok, adjust.error).toBe(true);
    expect(restoredCoinTrigger.session.state.cards.find((card) => card.uid === chariot.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: chariot.uid,
    });
    expect(restoredCoinTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "coinTossed", "controlChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: chariot.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: chariot.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: chariot.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: chariot.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Arcana Force VII - The Chariot");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_FLIP_SUMMON_SUCCESS)");
  expect(script).toContain("s.arcanareg(c,Arcana.TossCoin(c,tp))");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("return Arcana.GetCoinResult(c)==COIN_HEADS and c:IsRelateToBattle() and c:IsStatus(STATUS_OPPO_BATTLE)");
  expect(script).toContain("Duel.SetTargetCard(tc)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCode(EVENT_ADJUST)");
  expect(script).toContain("Duel.GetControl(c,1-tp,0,0)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const chariot = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === chariotCode);
  expect(chariot).toBeDefined();
  return [
    chariot!,
    { code: battleTargetCode, name: "Chariot Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestored(restored, pass!);
  }
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard, JSON.stringify({
      battleStep: restored.session.state.battleStep,
      pendingBattle: restored.session.state.pendingBattle,
      waitingFor: restored.session.state.waitingFor,
      legalActions: getLuaRestoreLegalActions(restored, restored.session.state.waitingFor ?? restored.session.state.turnPlayer),
    }, null, 2)).toBeLessThan(30);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestored(restored, pass!);
  }
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
