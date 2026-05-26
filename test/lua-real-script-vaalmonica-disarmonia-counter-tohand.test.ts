import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const disarmoniaCode = "65496951";
const pzoneCode = "654969510";
const banishedCode = "654969511";
const graveCode = "654969512";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const counterResonance = 0x211;
const setVaalmonica = 0x19c;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Vaalmonica Disarmonia counter to hand", () => {
  it("restores Resonance Counter placement, custom event raise, recover, and banished Vaalmonica return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${disarmoniaCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const source = fixtureSource(workspace);
    const session = createOpenSession(reader, workspace, source);
    const disarmonia = requireCard(session, disarmoniaCode);
    const pzone = requireCard(session, pzoneCode);
    const banished = requireCard(session, banishedCode);
    moveFaceUpPzone(session, pzone);
    moveFaceUp(session, banished, "banished");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, {
      promptOverrides: [
        { api: "SelectEffect", player: 0, returned: 1 },
        { api: "SelectYesNo", player: 0, returned: true },
      ],
    });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === disarmonia.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);

    expect(getDuelCardCounter(restored.session.state.cards.find((card) => card.uid === pzone.uid), counterResonance)).toBe(1);
    expect(restored.session.state.players[0].lifePoints).toBe(8500);
    expect(restored.session.state.cards.find((card) => card.uid === banished.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: disarmonia.uid,
      reasonEffectId: 1,
    });
    expect(restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1, 2], descriptions: [1047951217, 1047951218], returned: 1 },
      { id: "lua-prompt-2", api: "SelectYesNo", player: 0, description: 1047951219, returned: true },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["counterAdded", "customEvent", "breakEffect", "recoveredLifePoints", "sentToHand", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: pzone.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: disarmonia.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "customEvent",
        eventCode: 0x10000000 + 39210885,
        eventCardUid: pzone.uid,
        eventPlayer: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: disarmonia.uid,
        eventReasonEffectId: 1,
        eventValue: 1,
        eventUids: [pzone.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: disarmonia.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: disarmonia.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: disarmonia.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: banished.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: disarmonia.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: banished.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [banished.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: disarmonia.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores the damage branch and returns a face-up Vaalmonica card from graveyard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${disarmoniaCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const source = fixtureSource(workspace);
    const session = createOpenSession(reader, workspace, source);
    const disarmonia = requireCard(session, disarmoniaCode);
    const pzone = requireCard(session, pzoneCode);
    const grave = requireCard(session, graveCode);
    moveFaceUpPzone(session, pzone);
    moveFaceUp(session, grave, "graveyard");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, {
      promptOverrides: [
        { api: "SelectEffect", player: 0, returned: 2 },
        { api: "SelectYesNo", player: 0, returned: true },
      ],
    });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === disarmonia.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);

    expect(getDuelCardCounter(restored.session.state.cards.find((card) => card.uid === pzone.uid), counterResonance)).toBe(1);
    expect(restored.session.state.players[0].lifePoints).toBe(7500);
    expect(restored.session.state.cards.find((card) => card.uid === grave.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: disarmonia.uid,
      reasonEffectId: 1,
    });
    expect(restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1, 2], descriptions: [1047951217, 1047951218], returned: 2 },
      { id: "lua-prompt-2", api: "SelectYesNo", player: 0, description: 1047951220, returned: true },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["counterAdded", "customEvent", "breakEffect", "damageDealt", "sentToHand", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: pzone.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: disarmonia.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "customEvent",
        eventCode: 0x10000000 + 39210885,
        eventCardUid: pzone.uid,
        eventPlayer: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: disarmonia.uid,
        eventReasonEffectId: 1,
        eventValue: 1,
        eventUids: [pzone.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: disarmonia.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: disarmonia.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "breakEffect",
        eventCode: 1050,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: disarmonia.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: grave.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: disarmonia.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: grave.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [grave.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: disarmonia.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("CATEGORY_COUNTER+CATEGORY_RECOVER+CATEGORY_DAMAGE+CATEGORY_TOHAND");
  expect(script).toContain("EFFECT_COUNT_CODE_OATH");
  expect(script).toContain("Card.IsCanAddCounter");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,COUNTER_RESONANCE)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_GRAVE|LOCATION_REMOVED)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsCanAddCounter,tp,LOCATION_PZONE,0,1,1,nil,COUNTER_RESONANCE,1)");
  expect(script).toContain("Duel.RaiseEvent(tc,EVENT_CUSTOM+39210885");
  expect(script).toContain("Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.Recover(tp,500,REASON_EFFECT)");
  expect(script).toContain("Duel.Damage(tp,500,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,3))");
  expect(script).toContain("Duel.SendtoHand(sg,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,sg)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === disarmoniaCode),
    { code: pzoneCode, name: "Vaalmonica Fixture Pendulum", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, setcodes: [setVaalmonica], level: 4, attack: 1200, defense: 1200 },
    { code: banishedCode, name: "Vaalmonica Fixture Banished", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setVaalmonica], level: 4, attack: 1000, defense: 1000 },
    { code: graveCode, name: "Vaalmonica Fixture Grave", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setVaalmonica], level: 4, attack: 1100, defense: 1100 },
  ];
}

function createOpenSession(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  source: ReturnType<typeof fixtureSource>,
): DuelSession {
  const session = createDuel({ seed: 65496951, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [disarmoniaCode, pzoneCode, banishedCode, graveCode] }, 1: { main: [] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const disarmonia = requireCard(session, disarmoniaCode);
  moveDuelCard(session.state, disarmonia.uid, "hand", 0);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(disarmoniaCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(pzoneCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return session;
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${pzoneCode}.lua`) return resonancePendulumScript();
      return workspace.readScript(name);
    },
  };
}

function resonancePendulumScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      c:EnableCounterPermit(COUNTER_RESONANCE,LOCATION_PZONE)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpPzone(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = 0;
}

function moveFaceUp(session: DuelSession, card: DuelCardInstance, location: "banished" | "graveyard"): void {
  const moved = moveDuelCard(session.state, card.uid, location, 0);
  moved.faceUp = true;
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
