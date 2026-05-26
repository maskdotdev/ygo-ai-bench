import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, canPlayerSpecialSummon, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const aquaJetSurfaceCode = "32278723";
const summonTargetCode = "322787230";
const attackTargetCode = "322787231";
const opponentAttackCode = "322787232";
const fusionProbeCode = "322787233";
const xyzProbeCode = "322787234";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAquaJetSurfaceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${aquaJetSurfaceCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeFusion = 0x40;
const typeXyz = 0x800000;
const raceAqua = 0x40;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeEarth = 0x1;
const effectCannotSpecialSummon = 22;
const effectUpdateAttack = 100;
const effectFlagPlayerTargetClientHint = 0x4000800;
const resetEventStandard = 33427456;
const resetStandardPhaseEnd = 1107169792;
const summonTypeFusion = 0x43000000;
const summonTypeXyz = 0x49000000;

describe.skipIf(!hasUpstreamScripts || !hasAquaJetSurfaceScript)("Lua real script Aqua Jet Surface summon lock attack stat", () => {
  it("restores hand/GY Aqua summon with Extra Deck lock and grave self-banish ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectAquaJetSurfaceScriptShape(workspace.readScript(`official/c${aquaJetSurfaceCode}.lua`));
    const reader = createCardReader(cards());

    const restoredSummon = createRestoredSummonField({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const aquaJetSurface = requireCard(restoredSummon.session, aquaJetSurfaceCode);
    const summonTarget = requireCard(restoredSummon.session, summonTargetCode);
    const fusionProbe = requireCard(restoredSummon.session, fusionProbeCode);
    const xyzProbe = requireCard(restoredSummon.session, xyzProbeCode);
    const activation = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateEffect" && action.uid === aquaJetSurface.uid && action.effectId === "lua-1-1002",
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, activation!);
    resolveRestoredChain(restoredSummon);

    expect(restoredSummon.session.state.cards.find((card) => card.uid === aquaJetSurface.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredSummon.session.state.cards.find((card) => card.uid === summonTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: aquaJetSurface.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === summonTarget.uid && effect.code === effectCannotSpecialSummon).map((effect) => ({
      code: effect.code,
      description: effect.description,
      luaConditionDescriptor: effect.luaConditionDescriptor,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      property: effect.property,
      range: effect.range,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
    }))).toEqual([
      {
        code: effectCannotSpecialSummon,
        description: 516459570,
        luaConditionDescriptor: "condition:source-controller",
        luaTargetDescriptor: `special-summon-limit:not-type-extra:${typeXyz}`,
        property: effectFlagPlayerTargetClientHint,
        range: ["monsterZone"],
        registryKey: `lua:${aquaJetSurfaceCode}:lua-3-22`,
        reset: { flags: resetEventStandard },
        sourceUid: summonTarget.uid,
        targetRange: [1, 0],
      },
    ]);
    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredPersistent);
    expectRestoredLegalActions(restoredPersistent, 0);
    expect(canPlayerSpecialSummon(restoredPersistent.session.state, 0, restoredPersistent.session.state.cards.find((card) => card.uid === fusionProbe.uid), summonTypeFusion)).toBe(false);
    expect(canPlayerSpecialSummon(restoredPersistent.session.state, 0, restoredPersistent.session.state.cards.find((card) => card.uid === xyzProbe.uid), summonTypeXyz)).toBe(true);
    const probe = restoredPersistent.host.loadScript(
      `
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fusionProbeCode}),0,LOCATION_EXTRA,0,nil)
      local xyz=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${xyzProbeCode}),0,LOCATION_EXTRA,0,nil)
      Debug.Message("aqua jet surface fusion special " .. Duel.SpecialSummon(fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("aqua jet surface xyz special " .. Duel.SpecialSummon(xyz,SUMMON_TYPE_XYZ,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "aqua-jet-surface-extra-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restoredPersistent.host.messages).toEqual(
      expect.arrayContaining([
        "aqua jet surface fusion special 0",
        "aqua jet surface xyz special 1",
      ]),
    );
    expect(restoredPersistent.session.state.eventHistory.filter((event) => ["specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: summonTarget.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: aquaJetSurface.uid, eventReasonEffectId: 1, previous: "graveyard", current: "monsterZone" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: xyzProbe.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
    ]);

    const restoredAttack = createRestoredAttackField({ reader, workspace });
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const graveAquaJetSurface = requireCard(restoredAttack.session, aquaJetSurfaceCode);
    const attackTarget = requireCard(restoredAttack.session, attackTargetCode);
    const boost = getLuaRestoreLegalActions(restoredAttack, 0).find((action) =>
      action.type === "activateEffect" && action.uid === graveAquaJetSurface.uid && action.effectId === "lua-2",
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, boost!);
    resolveRestoredChain(restoredAttack);

    expect(restoredAttack.session.state.cards.find((card) => card.uid === graveAquaJetSurface.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveAquaJetSurface.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredAttack.session.state.cards.find((card) => card.uid === attackTarget.uid), restoredAttack.session.state)).toBe(2600);
    expect(restoredAttack.session.state.effects.filter((effect) => effect.sourceUid === attackTarget.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, registryKey: `lua:${aquaJetSurfaceCode}:lua-3-100`, reset: { flags: resetStandardPhaseEnd }, sourceUid: attackTarget.uid, value: 1000 },
    ]);
    expect(restoredAttack.session.state.eventHistory.filter((event) => ["banished", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: graveAquaJetSurface.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: graveAquaJetSurface.uid, eventReasonEffectId: 2, previous: "graveyard", current: "banished" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: attackTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "monsterZone" },
    ]);
    expect(restoredAttack.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredSummonField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 32278723, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [aquaJetSurfaceCode, summonTargetCode], extra: [fusionProbeCode, xyzProbeCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, aquaJetSurfaceCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, summonTargetCode).uid, "graveyard", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(aquaJetSurfaceCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredAttackField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 32278724, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [aquaJetSurfaceCode, attackTargetCode] }, 1: { main: [opponentAttackCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, aquaJetSurfaceCode).uid, "graveyard", 0);
  moveFaceUpAttack(session, requireCard(session, attackTargetCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, opponentAttackCode, 1), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(aquaJetSurfaceCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectAquaJetSurfaceScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Aqua Jet Surface");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_HAND|LOCATION_GRAVE,0,1,nil,e,tp)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spfilter),tp,LOCATION_HAND|LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("e1:SetTarget(function(e,c) return c:IsLocation(LOCATION_EXTRA) and not c:IsType(TYPE_XYZ) end)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsAttackPos,tp,0,LOCATION_MZONE,1,nil)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsRace,RACE_FISH|RACE_SEASERPENT|RACE_AQUA),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: aquaJetSurfaceCode, name: "Aqua Jet Surface", kind: "spell", typeFlags: typeSpell },
    { code: summonTargetCode, name: "Aqua Jet Surface Summon Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1400, defense: 1000 },
    { code: attackTargetCode, name: "Aqua Jet Surface Attack Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1600, defense: 1200 },
    { code: opponentAttackCode, name: "Aqua Jet Surface Opponent Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    { code: fusionProbeCode, name: "Aqua Jet Surface Fusion Probe", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceAqua, attribute: attributeWater, level: 4, attack: 2000, defense: 1800 },
    { code: xyzProbeCode, name: "Aqua Jet Surface Xyz Probe", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceAqua, attribute: attributeWater, level: 4, attack: 2200, defense: 1800 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string, controller?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.controller === controller));
  expect(card).toBeDefined();
  return card!;
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
