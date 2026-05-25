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
const aluberCode = "45005708";
const discardCode = "450057080";
const fieldDragonCode = "450057081";
const graveDragonCode = "450057082";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAluberScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${aluberCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const effectChangeCode = 114;
const cardAlbaz = 68468459;
const effectFlagSingleRange = 0x20000;
const effectFlagDelay = 0x10000;
const effectFlagCardTarget = 0x10;
const eventSummonSuccess = 1100;
const eventSpecialSummonSuccess = 1102;
const reasonDiscardCost = duelReason.cost | duelReason.discard;

describe.skipIf(!hasUpstreamScripts || !hasAluberScript)("Lua real script Bystial Aluber summon discard control revive", () => {
  it("restores normal-summon trigger discard cost, self-send, and Dragon control branch", () => {
    const fixture = setupFixture("field");
    const script = fixture.workspace.readScript(`official/c${aluberCode}.lua`);
    expectScriptShape(script);
    const { session, reader, workspace, aluber, discard, fieldDragon } = fixture;
    moveDuelCard(session.state, aluber.uid, "hand", 0);
    moveDuelCard(session.state, discard.uid, "hand", 0);
    moveFaceUpAttack(session, fieldDragon, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(aluberCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === aluber.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: effectChangeCode, event: "continuous", property: effectFlagSingleRange, range: ["monsterZone", "graveyard"], triggerEvent: undefined, value: cardAlbaz },
      { category: undefined, code: eventSummonSuccess, event: "trigger", property: effectFlagDelay | effectFlagCardTarget, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "normalSummoned", value: undefined },
      { category: undefined, code: eventSpecialSummonSuccess, event: "trigger", property: effectFlagDelay | effectFlagCardTarget, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned", value: undefined },
    ]);
    expectRestoredLegalActions(restoredOpen, 0);
    const normalSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === aluber.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, normalSummon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === aluber.uid && action.effectId === `lua-2-${eventSummonSuccess}`);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: reasonDiscardCost,
      reasonPlayer: 0,
      reasonCardUid: aluber.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === aluber.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: aluber.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === fieldDragon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: aluber.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === fieldDragon.uid)).toEqual([
      expect.objectContaining({
        eventCode: 1120,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: aluber.uid,
        eventReasonEffectId: 2,
        eventPreviousState: expect.objectContaining({ controller: 1, location: "monsterZone" }),
        eventCurrentState: expect.objectContaining({ controller: 0, location: "monsterZone" }),
      }),
    ]);
  });

  it("restores special-summon trigger discard cost, self-send, and graveyard Dragon revive branch", () => {
    const fixture = setupFixture("grave");
    const { session, reader, workspace, aluber, discard, graveDragon } = fixture;
    moveFaceUpAttack(session, aluber, 0);
    aluber.summonType = "special";
    moveDuelCard(session.state, discard.uid, "hand", 0);
    moveDuelCard(session.state, graveDragon.uid, "graveyard", 1);
    graveDragon.faceUp = true;
    graveDragon.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(aluberCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    session.state.pendingTriggers = [
      {
        id: "trigger-aluber-special",
        effectId: `lua-3-${eventSpecialSummonSuccess}`,
        sourceUid: aluber.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "specialSummoned",
        eventCode: eventSpecialSummonSuccess,
        eventPlayer: 0,
        eventCardUid: aluber.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ];

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === aluber.uid && action.effectId === `lua-3-${eventSpecialSummonSuccess}`);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: reasonDiscardCost,
      reasonPlayer: 0,
      reasonCardUid: aluber.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === aluber.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: aluber.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === graveDragon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: aluber.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === graveDragon.uid)).toEqual([
      expect.objectContaining({
        eventCode: eventSpecialSummonSuccess,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: aluber.uid,
        eventReasonEffectId: 3,
        eventPreviousState: expect.objectContaining({ controller: 1, location: "graveyard" }),
        eventCurrentState: expect.objectContaining({ controller: 0, location: "monsterZone" }),
      }),
    ]);
  });
});

function setupFixture(branch: "field" | "grave"): {
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  reader: ReturnType<typeof createCardReader>;
  session: DuelSession;
  aluber: DuelCardInstance;
  discard: DuelCardInstance;
  fieldDragon: DuelCardInstance;
  graveDragon: DuelCardInstance;
} {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const reader = createCardReader(cards());
  const session = createDuel({ seed: branch === "field" ? 45005708 : 45005709, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [aluberCode, discardCode] },
    1: { main: [fieldDragonCode, graveDragonCode] },
  });
  startDuel(session);
  return {
    workspace,
    reader,
    session,
    aluber: requireCard(session, aluberCode),
    discard: requireCard(session, discardCode),
    fieldDragon: requireCard(session, fieldDragonCode),
    graveDragon: requireCard(session, graveDragonCode),
  };
}

function cards(): DuelCardData[] {
  return [
    {
      code: aluberCode,
      name: "The Bystial Aluber",
      kind: "monster",
      typeFlags: typeMonster | typeEffect,
      race: raceDragon,
      attribute: attributeDark,
      level: 4,
      attack: 1800,
      defense: 0,
    },
    { code: discardCode, name: "Bystial Aluber Discard Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: fieldDragonCode, name: "Bystial Aluber Field Dragon Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
    { code: graveDragonCode, name: "Bystial Aluber Grave Dragon Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain('e1:SetValue(CARD_ALBAZ)');
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  moveDuelCard(session.state, card.uid, "monsterZone", controller);
  card.faceUp = true;
  card.position = "faceUpAttack";
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
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
