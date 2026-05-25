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
const strongWindCode = "23770284";
const dragonTributeCode = "237702840";
const nonDragonTributeCode = "237702841";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasStrongWindScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${strongWindCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeWind = 0x20;
const effectMaterialCheck = 251;
const effectIndestructibleBattle = 42;
const effectPierce = 203;
const effectUpdateAttack = 100;
const eventSummonSuccess = 1100;
const resetEventStandardDisable = 33492992;

describe.skipIf(!hasUpstreamScripts || !hasStrongWindScript)("Lua real script Strong Wind Dragon tribute material stat", () => {
  it("restores material-check Dragon tribute label into summon-success ATK gain and static battle effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${strongWindCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 23770284, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [strongWindCode, dragonTributeCode, nonDragonTributeCode] }, 1: { main: [] } });
    startDuel(session);

    const strongWind = requireCard(session, strongWindCode);
    const dragonTribute = requireCard(session, dragonTributeCode);
    const nonDragonTribute = requireCard(session, nonDragonTributeCode);
    moveDuelCard(session.state, strongWind.uid, "hand", 0);
    moveFaceUpAttack(session, dragonTribute, 0, 0);
    moveFaceUpAttack(session, nonDragonTribute, 0, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(strongWindCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === strongWind.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: 2097152, code: eventSummonSuccess, event: "trigger", property: undefined, sourceUid: strongWind.uid },
      { category: undefined, code: effectMaterialCheck, event: "continuous", property: undefined, sourceUid: strongWind.uid },
      { category: undefined, code: effectIndestructibleBattle, event: "continuous", property: undefined, sourceUid: strongWind.uid },
      { category: undefined, code: effectPierce, event: "continuous", property: undefined, sourceUid: strongWind.uid },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const tributeSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action): action is Extract<DuelAction, { type: "tributeSummon" }> =>
      action.type === "tributeSummon" && action.uid === strongWind.uid && action.tributeUids.includes(dragonTribute.uid) && !action.tributeUids.includes(nonDragonTribute.uid)
    );
    expect(tributeSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, tributeSummon!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === strongWind.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "tribute",
      summonMaterialUids: [dragonTribute.uid],
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === dragonTribute.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.summon,
      reasonCardUid: strongWind.uid,
    });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      sourceUid: trigger.sourceUid,
      player: trigger.player,
      triggerBucket: trigger.triggerBucket,
      eventName: trigger.eventName,
      eventCode: trigger.eventCode,
      eventCardUid: trigger.eventCardUid,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
    }))).toEqual([
      {
        sourceUid: strongWind.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "normalSummoned",
        eventCode: eventSummonSuccess,
        eventCardUid: strongWind.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === strongWind.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === strongWind.uid), restoredTrigger.session.state)).toBe(3300);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === strongWind.uid && [effectUpdateAttack, effectIndestructibleBattle, effectPierce].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectIndestructibleBattle, property: undefined, reset: undefined, sourceUid: strongWind.uid, value: undefined },
      { code: effectPierce, property: undefined, reset: undefined, sourceUid: strongWind.uid, value: undefined },
      { code: effectUpdateAttack, property: undefined, reset: { flags: resetEventStandardDisable }, sourceUid: strongWind.uid, value: 900 },
    ]);
    const summonEvents = restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "normalSummoning", "normalSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      relatedEffectId: event.relatedEffectId,
    }));
    expect(summonEvents).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: dragonTribute.uid, eventReason: duelReason.release | duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventName: "normalSummoning", eventCode: 1103, eventCardUid: strongWind.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "hand", relatedEffectId: undefined },
      { eventName: "normalSummoned", eventCode: eventSummonSuccess, eventCardUid: strongWind.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "hand", current: "monsterZone", relatedEffectId: undefined },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === strongWind.uid), restoredAfter.session.state)).toBe(3300);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Strong Wind Dragon");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EFFECT_MATERIAL_CHECK)");
  expect(script).toContain("e2:SetValue(s.valcheck)");
  expect(script).toContain("e2:SetLabelObject(e1)");
  expect(script).toContain("tc:IsRace(RACE_DRAGON)");
  expect(script).toContain("return e:GetHandler():IsTributeSummoned() and e:GetLabel()==1");
  expect(script).toContain("local atk=c:GetMaterial():GetFirst():GetTextAttack()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(atk/2)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
  expect(script).toContain("e3:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("return c:GetAttack()==e:GetHandler():GetAttack()");
  expect(script).toContain("e4:SetCode(EFFECT_PIERCE)");
}

function cards(): DuelCardData[] {
  return [
    { code: strongWindCode, name: "Strong Wind Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeWind, level: 6, attack: 2400, defense: 1000 },
    { code: dragonTributeCode, name: "Strong Wind Dragon Tribute", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeWind, level: 4, attack: 1800, defense: 1000 },
    { code: nonDragonTributeCode, name: "Strong Wind Non-Dragon Tribute", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWind, level: 4, attack: 1600, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
