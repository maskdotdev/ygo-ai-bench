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
const crystalCode = "22790789";
const targetCode = "227907890";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCrystalScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${crystalCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const besCounter = 0x1f;
const categoryCounter = 0x800000;
const categoryDestroy = 0x1;
const categoryPosition = 0x1000;

describe.skipIf(!hasUpstreamScripts || !hasCrystalScript)("Lua real script BES Crystal Core counter position", () => {
  it("restores summon counters, battle indestructibility, and targeted position change", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${crystalCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const restoredSummoned = summonCrystalCoreWithCounters({ reader, workspace });
    const crystal = requireCard(restoredSummoned.session, crystalCode);
    expect(getDuelCardCounter(crystal, besCounter)).toBe(3);
    expect(restoredSummoned.session.state.effects.find((effect) => effect.sourceUid === crystal.uid && effect.code === 0x10000 + besCounter)).toMatchObject({
      code: 0x10000 + besCounter,
      event: "continuous",
      range: ["monsterZone"],
      value: 4,
    });
    expect(restoredSummoned.session.state.effects.filter((effect) => effect.sourceUid === crystal.uid && effect.code !== 0x10000 + besCounter).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: categoryCounter, code: 1100, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "normalSummoned", value: undefined },
      { category: undefined, code: 42, event: "continuous", property: undefined, range: ["monsterZone"], triggerEvent: undefined, value: 1 },
      { category: undefined, code: 1141, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "damageStepEnded", value: undefined },
      { category: categoryDestroy, code: 1141, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "damageStepEnded", value: undefined },
      { category: categoryPosition, code: undefined, event: "ignition", property: 16, range: ["monsterZone"], triggerEvent: undefined, value: undefined },
    ]);
    expect(restoredSummoned.session.state.eventHistory.filter((event) => event.eventName === "counterAdded" && event.eventCardUid === crystal.uid)).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: crystal.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: crystal.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const target = requireCard(restoredSummoned.session, targetCode);
    moveFaceUpAttack(restoredSummoned.session, target, 1, 0);
    restoredSummoned.session.state.phase = "main1";
    restoredSummoned.session.state.turnPlayer = 0;
    restoredSummoned.session.state.waitingFor = 0;
    const restoredPosition = restoreDuelWithLuaScripts(serializeDuel(restoredSummoned.session), workspace, reader);
    expectCleanRestore(restoredPosition);
    expectRestoredLegalActions(restoredPosition, 0);
    const position = getLuaRestoreLegalActions(restoredPosition, 0).find((action) => action.type === "activateEffect" && action.uid === crystal.uid);
    expect(position, JSON.stringify(getLuaRestoreLegalActions(restoredPosition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPosition, position!);
    resolveRestoredChain(restoredPosition);

    expect(restoredPosition.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
      position: "faceUpDefense",
    });
    expect(restoredPosition.session.state.eventHistory.filter((event) => ["becameTarget", "positionChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: target.uid,
        eventValue: 1,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 6,
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: target.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: crystal.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);
  });
});

function summonCrystalCoreWithCounters({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 22790789, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [crystalCode] }, 1: { main: [targetCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, crystalCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(crystalCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restoredOpen);
  expectRestoredLegalActions(restoredOpen, 0);
  const crystal = requireCard(restoredOpen.session, crystalCode);
  const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === crystal.uid);
  expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredOpen, summon!);

  const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
  expectCleanRestore(restoredTrigger);
  expectRestoredLegalActions(restoredTrigger, 0);
  const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === crystal.uid && action.effectId?.endsWith("-1100"));
  expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredTrigger, trigger!);
  resolveRestoredChain(restoredTrigger);
  return restoredTrigger;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--B.E.S. Crystal Core");
  expect(script).toContain("c:EnableCounterPermit(0x1f)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,3,0,0x1f)");
  expect(script).toContain("e:GetHandler():AddCounter(0x1f,3)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e3:SetCode(EVENT_DAMAGE_STEP_END)");
  expect(script).toContain("c:RemoveCounter(tp,0x1f,1,REASON_EFFECT)");
  expect(script).toContain("return e:GetHandler():GetCounter(0x1f)==0");
  expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)");
  expect(script).toContain("e5:SetCategory(CATEGORY_POSITION)");
  expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,0,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.ChangePosition(tc,POS_FACEUP_DEFENSE)");
}

function cards(): DuelCardData[] {
  return [
    { code: crystalCode, name: "B.E.S. Crystal Core", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2100, defense: 1000 },
    { code: targetCode, name: "Crystal Core Position Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
