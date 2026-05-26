import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelEventRecord, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const emperorCode = "53136004";
const spellcasterCostCode = "531360040";
const spellbookCostCode = "531360041";
const opponentTargetCode = "531360042";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasEmperorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${emperorCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const setSpellbook = 0x106e;
const categoryControl = 0x2000;
const effectCannotAttackAnnounce = 86;

describe.skipIf(!hasUpstreamScripts || !hasEmperorScript)("Lua real script Emperor of Prophecy banish cost control lock", () => {
  it("restores Spellcaster plus Spellbook banish cost into temporary control and attack announce oath", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${emperorCode}.lua`);
    expectScriptShape(script ?? "");
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 53136004, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [emperorCode, spellcasterCostCode, spellbookCostCode] }, 1: { main: [opponentTargetCode] } });
    startDuel(session);
    const emperor = requireCard(session, emperorCode);
    const spellcasterCost = requireCard(session, spellcasterCostCode);
    const spellbookCost = requireCard(session, spellbookCostCode);
    const opponent = requireCard(session, opponentTargetCode);
    moveFaceUpAttack(session, emperor, 0, 0);
    moveFaceUpAttack(session, spellcasterCost, 0, 1);
    moveDuelCard(session.state, spellbookCost.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, opponent, 1, 0);
    prepareMainPhase(session);
    registerEmperor(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === emperor.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      countLimitCode: effect.countLimitCode,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: categoryControl, code: undefined, countLimit: 1, countLimitCode: Number(emperorCode), event: "ignition", id: "lua-1", property: 0x10, range: ["monsterZone"] },
    ]);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === emperor.uid && action.effectId === "lua-1");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === spellcasterCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: emperor.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === spellbookCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: emperor.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: emperor.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === emperor.uid && effect.code === effectCannotAttackAnnounce).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectCannotAttackAnnounce, event: "continuous", property: 0x4080400, reset: { flags: 0x41fe1200 }, sourceUid: emperor.uid },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["banished", "becameTarget", "controlChanged"].includes(event.eventName)).map(eventSummary)).toMatchInlineSnapshot(`
      [
        {
          "current": "banished",
          "currentController": 0,
          "eventCardUid": "p0-deck-531360040-1",
          "eventCode": 1011,
          "eventName": "banished",
          "eventReason": 128,
          "eventReasonCardUid": "p0-deck-53136004-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
          "previous": "monsterZone",
          "previousController": 0,
        },
        {
          "current": "banished",
          "currentController": 0,
          "eventCardUid": "p0-deck-531360041-2",
          "eventCode": 1011,
          "eventName": "banished",
          "eventReason": 128,
          "eventReasonCardUid": "p0-deck-53136004-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
          "previous": "graveyard",
          "previousController": 0,
        },
        {
          "current": "banished",
          "currentController": 0,
          "eventCardUid": "p0-deck-531360040-1",
          "eventCode": 1011,
          "eventName": "banished",
          "eventReason": 128,
          "eventReasonCardUid": "p0-deck-53136004-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
          "previous": "monsterZone",
          "previousController": 0,
        },
        {
          "current": "monsterZone",
          "currentController": 1,
          "eventCardUid": "p1-deck-531360042-0",
          "eventCode": 1028,
          "eventName": "becameTarget",
          "eventReason": 0,
          "eventReasonCardUid": undefined,
          "eventReasonEffectId": undefined,
          "eventReasonPlayer": 0,
          "previous": "deck",
          "previousController": 1,
        },
        {
          "current": "monsterZone",
          "currentController": 0,
          "eventCardUid": "p1-deck-531360042-0",
          "eventCode": 1120,
          "eventName": "controlChanged",
          "eventReason": 64,
          "eventReasonCardUid": "p0-deck-53136004-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
          "previous": "monsterZone",
          "previousController": 1,
        },
      ]
    `);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: emperorCode, name: "Emperor of Prophecy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 5, attack: 2300, defense: 2000 },
    { code: spellcasterCostCode, name: "Emperor of Prophecy Spellcaster Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
    { code: spellbookCostCode, name: "Emperor of Prophecy Spellbook Cost", kind: "spell", typeFlags: typeSpell, setcodes: [setSpellbook] },
    { code: opponentTargetCode, name: "Emperor of Prophecy Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("--Emperor of Prophecy");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_SPELLCASTER) and c:IsAbleToRemoveAsCost()");
  expect(script).toContain("return c:IsSetCard(SET_SPELLBOOK) and c:IsAbleToRemoveAsCost()");
  expect(script).toContain("e:GetHandler():GetAttackAnnouncedCount()==0");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter1,tp,LOCATION_MZONE,0,1,1,e:GetHandler())");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter2,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.Remove(g1,POS_FACEUP,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_OATH+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
}

function registerEmperor(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(emperorCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
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

function eventSummary(event: DuelEventRecord) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    previous: event.eventPreviousState?.location,
    current: event.eventCurrentState?.location,
    previousController: event.eventPreviousState?.controller,
    currentController: event.eventCurrentState?.controller,
  };
}
