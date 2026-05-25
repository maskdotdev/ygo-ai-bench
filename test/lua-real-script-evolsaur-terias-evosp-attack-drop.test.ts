import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const teriasCode = "69633792";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTeriasScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${teriasCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDinosaur = 0x800;
const attributeFire = 0x4;
const summonTypeEvoltile = 0x40000000 + 150;
const eventSpecialSummonSuccess = 1102;
const effectUpdateAttack = 100;
const resetEventStandardDisable = 33492992;

describe.skipIf(!hasUpstreamScripts || !hasTeriasScript)("Lua real script Evolsaur Terias evosp attack drop", () => {
  it("restores its Evoltile-coded Special Summon trigger into a self ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${teriasCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 69633792, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [teriasCode] }, 1: { main: [] } });
    startDuel(session);

    const terias = requireCard(session, teriasCode);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(teriasCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === terias.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: 2097152, code: eventSpecialSummonSuccess, event: "trigger", property: undefined, sourceUid: terias.uid, triggerEvent: "specialSummoned" },
    ]);

    specialSummonDuelCard(session.state, terias.uid, 0, 0, {}, summonTypeEvoltile, true, true);
    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    expect(restoredSummon.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        player: 0,
        effectId: "lua-1-1102",
        sourceUid: terias.uid,
        triggerBucket: "turnMandatory",
        eventName: "specialSummoned",
        eventCode: eventSpecialSummonSuccess,
        eventCardUid: terias.uid,
        eventPlayer: 0,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === terias.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, trigger!);
    expect(restoredSummon.session.state.chain).toEqual([]);
    expect(currentAttack(findCard(restoredSummon.session, terias.uid), restoredSummon.session.state)).toBe(1900);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === terias.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetEventStandardDisable }, sourceUid: terias.uid, value: -500 },
    ]);
    expect(restoredSummon.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: eventSpecialSummonSuccess,
        eventCardUid: terias.uid,
        eventPlayer: undefined,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        previous: "deck",
        current: "monsterZone",
      },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(findCard(restoredAfter.session, terias.uid), restoredAfter.session.state)).toBe(1900);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Evolsaur Terias");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e1:SetCondition(aux.evospcon)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-500)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
}

function cards(): DuelCardData[] {
  return [
    { code: teriasCode, name: "Evolsaur Terias", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeFire, level: 6, attack: 2400, defense: 600 },
  ];
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
