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
const rainbowCode = "79856792";
const crystalOneCode = "798567920";
const crystalTwoCode = "798567921";
const crystalGraveCode = "798567922";
const opponentFieldCode = "798567923";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRainbowScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rainbowCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const raceBeast = 0x4000;
const attributeLight = 0x10;
const attributeEarth = 0x8;
const setCrystalBeast = 0x1034;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasRainbowScript)("Lua real script Rainbow Dragon Crystal Beast cost stat to-Deck", () => {
  it("restores Crystal Beast send-cost quick ATK update", () => {
    const { workspace, reader, session } = createRainbowSession(79856792);
    const rainbow = requireCard(session, rainbowCode);
    const crystalOne = requireCard(session, crystalOneCode);
    const crystalTwo = requireCard(session, crystalTwoCode);
    const opponentField = requireCard(session, opponentFieldCode);
    moveFaceUpAttack(session, rainbow, 0, 0);
    moveFaceUpAttack(session, crystalOne, 0, 1);
    moveFaceUpAttack(session, crystalTwo, 0, 2);
    moveFaceUpAttack(session, opponentField, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rainbowCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "declareAttack" && action.attackerUid === rainbow.uid && action.targetUid === opponentField.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    passRestoredBattleAction(restoredOpen, 1, "passAttack");
    passRestoredBattleAction(restoredOpen, 0, "passAttack");
    passRestoredBattleAction(restoredOpen, 1, "passDamage");

    const boost = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === rainbow.uid && action.effectId === "lua-4-1002"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, boost!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === crystalOne.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: rainbow.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === crystalTwo.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: rainbow.uid,
      reasonEffectId: 4,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === rainbow.uid), restoredOpen.session.state)).toBe(6000);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33492992 }, sourceUid: rainbow.uid, value: 2000 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: crystalOne.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost, eventReasonCardUid: rainbow.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: crystalTwo.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost, eventReasonCardUid: rainbow.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: crystalOne.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost, eventReasonCardUid: rainbow.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores Crystal Beast banish cost into all-field shuffle", () => {
    const { workspace, reader, session } = createRainbowSession(79856793);
    const rainbow = requireCard(session, rainbowCode);
    const crystalOne = requireCard(session, crystalOneCode);
    const crystalGrave = requireCard(session, crystalGraveCode);
    const opponentField = requireCard(session, opponentFieldCode);
    moveFaceUpAttack(session, rainbow, 0, 0);
    moveFaceUpAttack(session, crystalOne, 0, 1);
    moveDuelCard(session.state, crystalGrave.uid, "graveyard", 0);
    moveFaceUpAttack(session, opponentField, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rainbowCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const shuffle = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === rainbow.uid && action.effectId === "lua-5"
    );
    expect(shuffle, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, shuffle!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === crystalOne.uid)).toMatchObject({
      location: "deck",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: rainbow.uid,
      reasonEffectId: 5,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === crystalGrave.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: rainbow.uid,
      reasonEffectId: 5,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === rainbow.uid)).toMatchObject({
      location: "deck",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: rainbow.uid,
      reasonEffectId: 5,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentField.uid)).toMatchObject({
      location: "deck",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: rainbow.uid,
      reasonEffectId: 5,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["banished", "sentToDeck"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: crystalGrave.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: rainbow.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, previous: "graveyard", current: "banished" },
      { eventCardUid: rainbow.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: rainbow.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, previous: "monsterZone", current: "deck" },
      { eventCardUid: crystalOne.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: rainbow.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, previous: "monsterZone", current: "deck" },
      { eventCardUid: opponentField.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: rainbow.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, previous: "monsterZone", current: "deck" },
      { eventCardUid: rainbow.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: rainbow.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, previous: "monsterZone", current: "deck" },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRainbowSession(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${rainbowCode}.lua`));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [rainbowCode, crystalOneCode, crystalTwoCode, crystalGraveCode] },
    1: { main: [opponentFieldCode] },
  });
  startDuel(session);
  return { workspace, reader, session };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Rainbow Dragon");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("e2:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e3:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel()*1000)");
  expect(script).toContain("e4:SetCategory(CATEGORY_TODECK)");
  expect(script).toContain("aux.SpElimFilter(c,true)");
  expect(script).toContain("Card.IsAbleToRemoveAsCost");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  expect(script).toContain("e5:SetCode(EVENT_SPSUMMON_SUCCESS)");
}

function cards(): DuelCardData[] {
  return [
    { code: rainbowCode, name: "Rainbow Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 10, attack: 4000, defense: 0 },
    { code: crystalOneCode, name: "Rainbow Fixture Crystal Beast One", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200, setcodes: [setCrystalBeast] },
    { code: crystalTwoCode, name: "Rainbow Fixture Crystal Beast Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000, setcodes: [setCrystalBeast] },
    { code: crystalGraveCode, name: "Rainbow Fixture Crystal Beast Grave", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1400, defense: 800, setcodes: [setCrystalBeast] },
    { code: opponentFieldCode, name: "Rainbow Fixture Opponent Field", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1500, defense: 1500 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passRestoredBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, type: "passAttack" | "passDamage"): void {
  expectRestoredLegalActions(restored, player);
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}
