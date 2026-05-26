import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel, synchroSummonDuelCard } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const ascensionCode = "37910722";
const tunerCode = "379107220";
const nonTunerCode = "379107221";
const handACode = "379107222";
const handBCode = "379107223";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAscensionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ascensionCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const typeTuner = 0x1000;
const raceDragon = 0x2000;
const attributeLight = 0x10;
const effectUpdateAttack = 100;
const effectDisable = 2;
const effectDisableEffect = 3;

describe.skipIf(!hasUpstreamScripts || !hasAscensionScript)("Lua real script Ascension Sky Dragon Synchro stat material revive", () => {
  it("restores Synchro Summon hand-count ATK gain and opponent-destroyed material SpecialSummonStep revive", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${ascensionCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 37910722, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [tunerCode, nonTunerCode, handACode, handBCode], extra: [ascensionCode] },
      1: { main: [] },
    });
    startDuel(session);

    const ascension = requireCard(session, ascensionCode);
    const tuner = requireCard(session, tunerCode);
    const nonTuner = requireCard(session, nonTunerCode);
    moveFaceUpAttack(session, tuner, 0, 0);
    moveFaceUpAttack(session, nonTuner, 0, 1);
    moveDuelCard(session.state, requireCard(session, handACode).uid, "hand", 0);
    moveDuelCard(session.state, requireCard(session, handBCode).uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ascensionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    synchroSummonDuelCard(session.state, 0, ascension.uid, [tuner.uid, nonTuner.uid]);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summonTrigger = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === ascension.uid
    );
    expect(summonTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summonTrigger!);
    resolveRestoredChain(restoredSummon);

    expect(currentAttack(restoredSummon.session.state.cards.find((card) => card.uid === ascension.uid), restoredSummon.session.state)).toBe(9600);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === ascension.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 33492992 }, sourceUid: ascension.uid, value: 1600 },
    ]);

    const reviveSession = createDuel({ seed: 37910723, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(reviveSession, {
      0: { main: [tunerCode, nonTunerCode], extra: [ascensionCode] },
      1: { main: [] },
    });
    startDuel(reviveSession);
    const reviveAscension = requireCard(reviveSession, ascensionCode);
    const reviveTuner = requireCard(reviveSession, tunerCode);
    const reviveNonTuner = requireCard(reviveSession, nonTunerCode);
    const movedAscension = moveDuelCard(reviveSession.state, reviveAscension.uid, "monsterZone", 0);
    movedAscension.faceUp = true;
    movedAscension.position = "faceUpAttack";
    movedAscension.summonType = "synchro";
    movedAscension.summonMaterialUids = [reviveTuner.uid, reviveNonTuner.uid];
    for (const material of [reviveTuner, reviveNonTuner]) {
      const moved = moveDuelCard(reviveSession.state, material.uid, "graveyard", 0);
      moved.faceUp = true;
      moved.reason = duelReason.synchro | duelReason.material;
      moved.reasonPlayer = 0;
      moved.reasonCardUid = reviveAscension.uid;
    }
    reviveSession.state.phase = "main1";
    reviveSession.state.turnPlayer = 0;
    reviveSession.state.waitingFor = 0;
    const reviveHost = createLuaScriptHost(reviveSession, workspace);
    expect(reviveHost.loadCardScript(Number(ascensionCode), workspace).ok).toBe(true);
    expect(reviveHost.registerInitialEffects()).toBe(1);
    destroyDuelCard(reviveSession.state, reviveAscension.uid, 0, duelReason.effect | duelReason.destroy, 1, "graveyard", {
      eventReasonCardUid: reviveAscension.uid,
      eventReasonEffectId: 99,
    });
    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(reviveSession), workspace, reader);
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    const reviveTrigger = getLuaRestoreLegalActions(restoredDestroyed, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === ascension.uid
    );
    expect(reviveTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyed, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyed, reviveTrigger!);
    resolveRestoredChain(restoredDestroyed);

    for (const material of [reviveTuner, reviveNonTuner]) {
      expect(restoredDestroyed.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "monsterZone",
        controller: 0,
        faceUp: true,
        position: "faceUpAttack",
        summonType: "special",
        reason: duelReason.summon | duelReason.specialSummon,
        reasonPlayer: 0,
        reasonCardUid: reviveAscension.uid,
        reasonEffectId: 4,
      });
    }
    expect(restoredDestroyed.session.state.effects.filter((effect) => effect.code !== undefined && [effectDisable, effectDisableEffect].includes(effect.code)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectDisable, event: "continuous", reset: { flags: 33427456 }, sourceUid: reviveTuner.uid, value: undefined },
      { code: effectDisable, event: "continuous", reset: { flags: 33427456 }, sourceUid: reviveNonTuner.uid, value: undefined },
    ]);
    expect(restoredDestroyed.session.state.eventHistory.filter((event) => ["usedAsMaterial", "specialSummoned", "destroyed"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: reviveAscension.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: reviveAscension.uid, eventReasonEffectId: 99, eventReasonPlayer: 1, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: reviveTuner.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: reviveAscension.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "graveyard", current: "monsterZone" },
    ]);
    expect(restoredDestroyed.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Ascension Sky Dragon");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsSynchroSummoned()");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_HAND,0)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ct*800)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return rp~=tp and c:IsReason(REASON_DESTROY)");
  expect(script).toContain("Duel.SetTargetCard(mg)");
  expect(script).toContain("local mg=Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
  expect(script).toContain("Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
}

function cards(): DuelCardData[] {
  return [
    { code: ascensionCode, name: "Ascension Sky Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceDragon, attribute: attributeLight, level: 10, attack: 8000, defense: 3000 },
    { code: tunerCode, name: "Ascension Sky Dragon Tuner", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceDragon, attribute: attributeLight, level: 2, attack: 500, defense: 500 },
    { code: nonTunerCode, name: "Ascension Sky Dragon Non-Tuner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 8, attack: 2500, defense: 2000 },
    { code: handACode, name: "Ascension Hand A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 4, attack: 1500, defense: 1200 },
    { code: handBCode, name: "Ascension Hand B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 4, attack: 1500, defense: 1200 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
