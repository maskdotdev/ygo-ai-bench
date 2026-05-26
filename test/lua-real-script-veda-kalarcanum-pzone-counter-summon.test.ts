import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLeftScale, currentRightScale } from "#duel/card-stats.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const vedaCode = "40785230";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasVedaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${vedaCode}.lua`));
const counterVeda = 0x210;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceWarrior = 0x1;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasVedaScript)("Lua real script Veda Kalarcanum PZone counter summon", () => {
  it("restores Veda Counter scale updates into PZone self Special Summon cost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${vedaCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 40785230, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [vedaCode] }, 1: { main: [] } });
    startDuel(session);

    const veda = requireCard(session, vedaCode);
    movePzone(session, veda);
    expect(addDuelCardCounter(veda, counterVeda, 12)).toBe(true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(vedaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(currentLeftScale(veda, session.state)).toBe(12);
    expect(currentRightScale(veda, session.state)).toBe(12);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const restoredVeda = findCard(restored.session, veda.uid);
    expect(currentLeftScale(restoredVeda, restored.session.state)).toBe(12);
    expect(currentRightScale(restoredVeda, restored.session.state)).toBe(12);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === veda.uid && [134, 136].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { code: 134, event: "continuous", property: 0x20000, range: ["spellTrapZone"], value: undefined },
      { code: 136, event: "continuous", property: 0x20000, range: ["spellTrapZone"], value: undefined },
    ]);

    const summon = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === veda.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, summon!);
    resolveRestoredChain(restored);

    expect(getDuelCardCounter(findCard(restored.session, veda.uid), counterVeda)).toBe(0);
    expect(findCard(restored.session, veda.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: veda.uid,
      reasonEffectId: 9,
    });
    expect(restored.session.state.eventHistory.filter((event) => ["counterRemoved", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: veda.uid, eventCode: 0x20000, eventName: "counterRemoved", eventReason: duelReason.cost, eventReasonCardUid: veda.uid, eventReasonEffectId: 9, eventReasonPlayer: 0 },
      { eventCardUid: veda.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: veda.uid, eventReasonEffectId: 9, eventReasonPlayer: 0 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: vedaCode, name: "Veda Kalarcanum", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceWarrior, attribute: attributeDark, level: 12, attack: 0, defense: 4000, leftScale: 0, rightScale: 0 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("c:EnableCounterPermit(COUNTER_VEDA,LOCATION_PZONE)");
  expect(script).toContain("c:SetSPSummonOnce(id)");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e0:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_VEDA,3)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_LSCALE)");
  expect(script).toContain("e2b:SetCode(EFFECT_UPDATE_RSCALE)");
  expect(script).toContain("c:RemoveCounter(tp,COUNTER_VEDA,12,REASON_COST)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,true,true,POS_FACEUP)");
  expect(script).toContain("Duel.SkipPhase(turn_player,PHASE_BATTLE,RESET_PHASE|PHASE_END,1,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BP)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND|LOCATION_DECK|LOCATION_GRAVE|LOCATION_REMOVED)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,4))");
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

function movePzone(session: DuelSession, card: DuelCardInstance): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
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
