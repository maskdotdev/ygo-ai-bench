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
const defenderCode = "2525268";
const allyCode = "25252680";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDefenderScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${defenderCode}.lua`));
const counterSpell = 0x1;
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceSpellcaster = 0x80;
const attributeLight = 0x10;
const categoryCounter = 0x800000;
const effectDestroyReplace = 50;
const eventSummonSuccess = 1100;
const promptOverrides = [{ api: "SelectEffectYesNo" as const, player: 0 as const, returned: true }];

describe.skipIf(!hasUpstreamScripts || !hasDefenderScript)("Lua real script Defender Magical Knight counter replace", () => {
  it("restores normal summon Spell Counter placement and counter-cost Spellcaster destroy replacement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${defenderCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 2525268, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [defenderCode, allyCode] }, 1: { main: [] } });
    startDuel(session);

    const defender = requireCard(session, defenderCode);
    const ally = requireCard(session, allyCode);
    moveDuelCard(session.state, defender.uid, "hand", 0);
    moveFaceUpAttack(session, ally, 0, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(defenderCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === defender.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 0x10000 + counterSpell, event: "continuous", range: ["hand"], sourceUid: defender.uid },
      { category: undefined, code: 0x20000 + counterSpell, event: "continuous", range: ["hand"], sourceUid: defender.uid },
      { category: categoryCounter, code: eventSummonSuccess, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], sourceUid: defender.uid },
      { category: undefined, code: effectDestroyReplace, event: "continuous", range: ["monsterZone"], sourceUid: defender.uid },
    ]);

    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "normalSummon" && action.uid === defender.uid
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    const trigger = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === defender.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, trigger!);
    resolveRestoredChain(restoredSummon);

    expect(getDuelCardCounter(findCard(restoredSummon.session, defender.uid), counterSpell)).toBe(1);
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["normalSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: defender.uid, eventCode: eventSummonSuccess, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: defender.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: defender.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);

    const restoredAfterCounter = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredAfterCounter);
    expectRestoredLegalActions(restoredAfterCounter, 0);
    expect(restoredAfterCounter.session.state.effects.filter((effect) => effect.sourceUid === defender.uid && effect.code === effectDestroyReplace).map((effect) => ({
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectDestroyReplace, countLimit: 1, event: "continuous", range: ["monsterZone"], sourceUid: defender.uid },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: defenderCode, name: "Defender, the Magical Knight", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1600, defense: 2000 },
    { code: allyCode, name: "Defender Spellcaster Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1400, defense: 1200 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Defender, the Magical Knight");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
  expect(script).toContain("c:SetCounterLimit(COUNTER_SPELL,1)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,COUNTER_SPELL)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_SPELL,1)");
  expect(script).toContain("e2:SetCode(EFFECT_DESTROY_REPLACE)");
  expect(script).toContain("return count>0 and Duel.IsCanRemoveCounter(tp,1,0,COUNTER_SPELL,count,REASON_COST)");
  expect(script).toContain("return Duel.SelectEffectYesNo(tp,e:GetHandler(),96)");
  expect(script).toContain("return c:IsFaceup() and c:IsLocation(LOCATION_MZONE) and c:IsRace(RACE_SPELLCASTER)");
  expect(script).toContain("Duel.RemoveCounter(tp,1,0,COUNTER_SPELL,count,REASON_COST)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
