import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const masterCode = "34160055";
const summonProbeCode = "341600550";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMasterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${masterCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const effectUpdateAttack = 100;
const effectUpdateLevel = 130;

describe.skipIf(!hasUpstreamScripts || !hasMasterScript)("Lua real script Master of the Flaming Dragonswords summon Level stat", () => {
  it("restores Summon Success effect relation into summoned monster Level gain and self ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${masterCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restoredSummonOpen = createRestoredSummonOpen({ reader, workspace });
    expectCleanRestore(restoredSummonOpen);
    expectRestoredLegalActions(restoredSummonOpen, 0);
    const master = requireCard(restoredSummonOpen.session, masterCode);
    const summonProbe = requireCard(restoredSummonOpen.session, summonProbeCode);
    expect(currentLevel(summonProbe, restoredSummonOpen.session.state)).toBe(4);
    expect(currentAttack(master, restoredSummonOpen.session.state)).toBe(1800);

    const normalSummon = getLuaRestoreLegalActions(restoredSummonOpen, 0).find((action) => action.type === "normalSummon" && action.uid === summonProbe.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonOpen, normalSummon!);
    expect(restoredSummonOpen.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned")).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: summonProbe.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummonOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1100",
        sourceUid: master.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "normalSummoned",
        eventCode: 1100,
        eventPlayer: 0,
        eventCardUid: summonProbe.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === master.uid && action.effectId === "lua-1-1100"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);

    expect(currentLevel(findCard(restoredTrigger.session, summonProbe.uid), restoredTrigger.session.state)).toBe(5);
    expect(currentAttack(findCard(restoredTrigger.session, master.uid), restoredTrigger.session.state)).toBe(2100);
    expect(restoredTrigger.session.state.effects.filter((effect) => [effectUpdateAttack, effectUpdateLevel].includes(effect.code)).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      sourceUid: effect.sourceUid,
      value: effect.value,
      reset: effect.reset,
    }))).toEqual([
      {
        code: effectUpdateLevel,
        controller: 0,
        event: "continuous",
        sourceUid: summonProbe.uid,
        value: 1,
        reset: { flags: 33427456 },
      },
      {
        code: effectUpdateAttack,
        controller: 0,
        event: "continuous",
        sourceUid: master.uid,
        value: 300,
        reset: { flags: 1107235328 },
      },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredAfterStats = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredAfterStats);
    expectRestoredLegalActions(restoredAfterStats, 0);
    expect(currentLevel(findCard(restoredAfterStats.session, summonProbe.uid), restoredAfterStats.session.state)).toBe(5);
    expect(currentAttack(findCard(restoredAfterStats.session, master.uid), restoredAfterStats.session.state)).toBe(2100);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: masterCode, name: "Master of the Flaming Dragonswords", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1800, defense: 1200 },
    { code: summonProbeCode, name: "Flaming Dragonswords Summon Probe", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1500, defense: 1500 },
  ];
}

function createRestoredSummonOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 34160055, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [masterCode, summonProbeCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, masterCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, summonProbeCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(masterCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Master of the Flaming Dragonswords");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_TRIGGER_O+EFFECT_TYPE_FIELD)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("tc:CreateEffectRelation(e)");
  expect(script).toContain("tc:IsFaceup() and tc:IsRelateToEffect(e)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_LEVEL)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetValue(300)");
  expect(script).toContain("e2:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
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
