import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDuelCardCounter } from "#duel/counters.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const rogueCode = "44640691";
const discardCode = "446406910";
const setSpellCode = "446406911";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRogueScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rogueCode}.lua`));
const counterSpell = 0x1;
const effectCannotActivate = 6;
const effectCannotTrigger = 7;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const raceSpellcaster = 0x2;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasRogueScript)("Lua real script Rogue of Endymion counter set lock", () => {
  it("restores summon Spell Counter into discard-cost Continuous Spell set locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rogueCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 44640691, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rogueCode, discardCode, setSpellCode] }, 1: { main: [] } });
    startDuel(session);

    const rogue = requireCard(session, rogueCode);
    const discard = requireCard(session, discardCode);
    const setSpell = requireCard(session, setSpellCode);
    moveDuelCard(session.state, rogue.uid, "hand", 0);
    moveDuelCard(session.state, discard.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rogueCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === rogue.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);

    const restoredSummoned = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredSummoned);
    expectRestoredLegalActions(restoredSummoned, 0);
    const trigger = getLuaRestoreLegalActions(restoredSummoned, 0).find((action) => action.type === "activateTrigger" && action.uid === rogue.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummoned, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummoned, trigger!);
    expect(getDuelCardCounter(findCard(restoredSummoned.session, rogue.uid), counterSpell)).toBe(1);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredSummoned.session), workspace, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const setAction = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === rogue.uid);
    expect(setAction, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, setAction!);
    resolveRestoredChain(restoredIgnition);

    expect(getDuelCardCounter(findCard(restoredIgnition.session, rogue.uid), counterSpell)).toBe(0);
    expect(findCard(restoredIgnition.session, discard.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: rogue.uid,
      reasonEffectId: 4,
    });
    expect(findCard(restoredIgnition.session, setSpell.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: false,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredIgnition.session.state.effects.filter((effect) =>
      effect.sourceUid === setSpell.uid && effect.code === effectCannotTrigger ||
      effect.sourceUid === rogue.uid && effect.code === effectCannotActivate
    ).map((effect) => ({
      code: effect.code,
      label: effect.label,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: effectCannotTrigger, label: undefined, property: undefined, reset: { flags: 1098781184 }, sourceUid: setSpell.uid, targetRange: undefined },
      { code: effectCannotActivate, label: Number(setSpellCode), property: 67110912, reset: { flags: 1073742336 }, sourceUid: rogue.uid, targetRange: [1, 0] },
    ]);
    expect(restoredIgnition.session.state.eventHistory.filter((event) =>
      ["normalSummoned", "counterAdded", "counterRemoved", "discarded"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: rogue.uid, eventCode: 1100, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: rogue.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: rogue.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: rogue.uid, eventCode: 0x20000, eventName: "counterRemoved", eventReason: duelReason.cost, eventReasonCardUid: rogue.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
      { eventCardUid: discard.uid, eventCode: 1018, eventName: "discarded", eventReason: duelReason.cost | duelReason.discard, eventReasonCardUid: rogue.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: rogueCode, name: "Rogue of Endymion", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 3, attack: 1500, defense: 200 },
    { code: discardCode, name: "Rogue Discard Spellcaster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: setSpellCode, name: "Rogue Set Continuous Spell", kind: "spell", typeFlags: typeSpell | typeContinuous },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("c:AddCounter(COUNTER_SPELL,1)");
  expect(script).toContain("e3:SetCategory(CATEGORY_SET)");
  expect(script).toContain("c:RemoveCounter(tp,COUNTER_SPELL,1,REASON_COST)");
  expect(script).toContain("Duel.DiscardHand(tp,s.cfilter,1,1,REASON_DISCARD+REASON_COST,nil)");
  expect(script).toContain("return c:IsSpell() and c:IsType(TYPE_CONTINUOUS) and c:IsSSetable()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.setfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SSet(tp,g)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_TRIGGER)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_ACTIVATE)");
  expect(script).toContain("e2:SetLabel(tc:GetCode())");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
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
