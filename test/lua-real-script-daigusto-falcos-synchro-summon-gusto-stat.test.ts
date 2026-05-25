import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const falcosCode = "34109611";
const tunerCode = "341096110";
const gustoNonTunerCode = "341096111";
const ownGustoCode = "341096112";
const opponentGustoCode = "341096113";
const opponentDecoyCode = "341096114";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasFalcosScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${falcosCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const raceWingedBeast = 0x80;
const attributeWind = 0x20;
const setGusto = 0x10;
const effectUpdateAttack = 100;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasFalcosScript)("Lua real script Daigusto Falcos Synchro summon Gusto stat", () => {
  it("restores NonTunerEx Gusto Synchro metadata into summon-triggered field ATK boosts", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${falcosCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 34109611, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [tunerCode, gustoNonTunerCode, ownGustoCode], extra: [falcosCode] },
      1: { main: [opponentGustoCode, opponentDecoyCode] },
    });
    startDuel(session);

    const falcos = requireCard(session, falcosCode);
    const tuner = requireCard(session, tunerCode);
    const gustoNonTuner = requireCard(session, gustoNonTunerCode);
    const ownGusto = requireCard(session, ownGustoCode);
    const opponentGusto = requireCard(session, opponentGustoCode);
    const opponentDecoy = requireCard(session, opponentDecoyCode);
    moveFaceUpAttack(session, tuner, 0, 0);
    moveFaceUpAttack(session, gustoNonTuner, 0, 1);
    moveFaceUpAttack(session, ownGusto, 0, 2);
    moveFaceUpAttack(session, opponentGusto, 1, 0);
    moveFaceUpAttack(session, opponentDecoy, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(falcosCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(falcos.data).toMatchObject({
      synchroTunerMin: 1,
      synchroTunerMax: 1,
      synchroNonTunerMin: 1,
      synchroNonTunerMax: 99,
      synchroNonTunerSetcode: setGusto,
    });
    expect(session.state.effects.filter((effect) => effect.sourceUid === falcos.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, sourceUid: falcos.uid },
      { category: 2097152, code: 1102, event: "trigger", property: undefined, sourceUid: falcos.uid },
    ]);

    const synchroSummon = getLegalActions(session, 0).find((action): action is Extract<DuelAction, { type: "synchroSummon" }> =>
      action.type === "synchroSummon" && action.uid === falcos.uid && sameMembers(action.materialUids, [tuner.uid, gustoNonTuner.uid])
    );
    expect(synchroSummon, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, synchroSummon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === falcos.uid)?.data).toMatchObject({
      synchroNonTunerSetcode: setGusto,
      synchroNonTunerMin: 1,
      synchroNonTunerMax: 99,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === falcos.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "synchro",
      summonMaterialUids: [tuner.uid, gustoNonTuner.uid],
    });
    for (const material of [tuner, gustoNonTuner]) {
      expect(restoredTrigger.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "graveyard",
        controller: 0,
        reason: duelReason.material | duelReason.synchro,
      });
    }
    expect(restoredTrigger.session.state.pendingTriggers.map((trigger) => ({
      sourceUid: trigger.sourceUid,
      player: trigger.player,
      triggerBucket: trigger.triggerBucket,
      eventName: trigger.eventName,
      eventCode: trigger.eventCode,
      eventCardUid: trigger.eventCardUid,
    }))).toEqual([
      {
        sourceUid: falcos.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: falcos.uid,
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === falcos.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === falcos.uid), restoredTrigger.session.state)).toBe(2000);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === ownGusto.uid), restoredTrigger.session.state)).toBe(1900);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentGusto.uid), restoredTrigger.session.state)).toBe(1800);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentDecoy.uid), restoredTrigger.session.state)).toBe(1700);
    expect(restoredTrigger.session.state.effects.filter((effect) => [falcos.uid, ownGusto.uid, opponentGusto.uid, opponentDecoy.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 1024, reset: { flags: resetEventStandard }, sourceUid: falcos.uid, value: 600 },
      { code: effectUpdateAttack, property: 1024, reset: { flags: resetEventStandard }, sourceUid: ownGusto.uid, value: 600 },
      { code: effectUpdateAttack, property: 1024, reset: { flags: resetEventStandard }, sourceUid: opponentGusto.uid, value: 600 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["usedAsMaterial", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: tuner.uid, eventReason: duelReason.synchro, eventReasonPlayer: 0, eventReasonCardUid: falcos.uid, eventReasonEffectId: undefined, relatedEffectId: undefined },
      { eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: gustoNonTuner.uid, eventReason: duelReason.synchro, eventReasonPlayer: 0, eventReasonCardUid: falcos.uid, eventReasonEffectId: undefined, relatedEffectId: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: falcos.uid, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === ownGusto.uid), restoredAfter.session.state)).toBe(1900);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Daigusto Falcos");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTunerEx(Card.IsSetCard,SET_GUSTO),1,99)");
  expect(script).toContain("return e:GetHandler():IsSynchroSummoned()");
  expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_GUSTO)");
  expect(script).toContain("for tc in aux.Next(g) do");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
  expect(script).toContain("e1:SetValue(600)");
}

function cards(): DuelCardData[] {
  return [
    { code: falcosCode, name: "Daigusto Falcos", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWingedBeast, attribute: attributeWind, level: 4, attack: 1400, defense: 1200, setcodes: [setGusto] },
    { code: tunerCode, name: "Daigusto Falcos Tuner", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceWingedBeast, attribute: attributeWind, level: 2, attack: 800, defense: 1000 },
    { code: gustoNonTunerCode, name: "Daigusto Falcos Gusto Non-Tuner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeWind, level: 2, attack: 1000, defense: 800, setcodes: [setGusto] },
    { code: ownGustoCode, name: "Daigusto Falcos Own Gusto", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeWind, level: 4, attack: 1300, defense: 1000, setcodes: [setGusto] },
    { code: opponentGustoCode, name: "Daigusto Falcos Opponent Gusto", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeWind, level: 4, attack: 1200, defense: 1000, setcodes: [setGusto] },
    { code: opponentDecoyCode, name: "Daigusto Falcos Opponent Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeWind, level: 4, attack: 1700, defense: 1000 },
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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

function sameMembers(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((uid) => actual.includes(uid));
}
