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
const heroicCallCode = "32175429";
const nonHeroicWarriorCode = "321754290";
const heroicTargetCode = "321754291";
const overlayHolderCode = "321754292";
const heroicOverlayCode = "321754293";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasHeroicCallScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${heroicCallCode}.lua`));
const setHeroic = 0x6f;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const effectDisable = 2;
const effectCannotAttack = 85;
const effectUpdateAttack = 100;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasHeroicCallScript)("Lua real script Heroic Call summon disable overlay stat", () => {
  it("restores non-Heroic Warrior summon locks and grave overlay-count ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${heroicCallCode}.lua`));
    const databaseHeroicCall = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === heroicCallCode);
    expect(databaseHeroicCall).toBeDefined();
    const reader = createCardReader([
      databaseHeroicCall!,
      ...cards(),
    ]);

    const restoredSummon = createRestoredHeroicCallField({ reader, workspace, scenario: "summon" });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summonCall = requireCard(restoredSummon.session, heroicCallCode);
    const nonHeroic = requireCard(restoredSummon.session, nonHeroicWarriorCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateEffect" && action.uid === summonCall.uid && action.effectId === "lua-1-1002"
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    resolveRestoredChain(restoredSummon);

    expect(restoredSummon.session.state.cards.find((card) => card.uid === nonHeroic.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonCall.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.effects.filter((effect) =>
      [nonHeroic.uid, summonCall.uid].includes(effect.sourceUid) &&
      [effectDisable, effectCannotAttack].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      description: effect.description,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      {
        code: effectDisable,
        description: undefined,
        registryKey: `lua:${heroicCallCode}:lua-3-2`,
        reset: { flags: resetEventStandard },
        sourceUid: nonHeroic.uid,
        value: undefined,
      },
      {
        code: effectCannotAttack,
        description: 3206,
        registryKey: `lua:${heroicCallCode}:lua-5-85`,
        reset: { flags: resetEventStandard },
        sourceUid: nonHeroic.uid,
        value: undefined,
      },
    ]);
    expect(restoredSummon.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
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
      { eventCardUid: nonHeroic.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: summonCall.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "graveyard", current: "monsterZone" },
    ]);

    const restoredStat = createRestoredHeroicCallField({ reader, workspace, scenario: "stat" });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const statCall = requireCard(restoredStat.session, heroicCallCode);
    const heroicTarget = requireCard(restoredStat.session, heroicTargetCode);
    const overlayHolder = requireCard(restoredStat.session, overlayHolderCode);
    const heroicOverlay = requireCard(restoredStat.session, heroicOverlayCode);
    const stat = getLuaRestoreLegalActions(restoredStat, 0).find((action) =>
      action.type === "activateEffect" && action.uid === statCall.uid && action.effectId === "lua-2"
    );
    expect(stat, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, stat!);
    resolveRestoredChain(restoredStat);

    expect(restoredStat.session.state.cards.find((card) => card.uid === statCall.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: statCall.uid,
      reasonEffectId: 2,
    });
    expect(restoredStat.session.state.cards.find((card) => card.uid === heroicOverlay.uid)).toMatchObject({ location: "overlay", controller: 0 });
    expect(restoredStat.session.state.cards.find((card) => card.uid === overlayHolder.uid)?.overlayUids).toEqual([heroicOverlay.uid]);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === heroicTarget.uid), restoredStat.session.state)).toBe(2800);
    expect(restoredStat.session.state.effects.filter((effect) => effect.sourceUid === heroicTarget.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      {
        code: effectUpdateAttack,
        registryKey: `lua:${heroicCallCode}:lua-3-100`,
        reset: { flags: resetEventStandard },
        sourceUid: heroicTarget.uid,
        value: 1000,
      },
    ]);
    expect(restoredStat.session.state.eventHistory.filter((event) => ["banished", "becameTarget"].includes(event.eventName)).map((event) => ({
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
      { eventCardUid: statCall.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: statCall.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "graveyard", current: "banished" },
      { eventCardUid: heroicTarget.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", current: "monsterZone" },
    ]);

    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredStat.session), workspace, reader);
    expectCleanRestore(restoredPersistent);
    expectRestoredLegalActions(restoredPersistent, 0);
    expect(currentAttack(restoredPersistent.session.state.cards.find((card) => card.uid === heroicTarget.uid), restoredPersistent.session.state)).toBe(2800);
    expect(restoredPersistent.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredHeroicCallField({
  reader,
  workspace,
  scenario,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  scenario: "summon" | "stat";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: scenario === "summon" ? 32175429 : 32175430, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  if (scenario === "summon") {
    loadDecks(session, { 0: { main: [heroicCallCode, nonHeroicWarriorCode] }, 1: { main: [] } });
  } else {
    loadDecks(session, { 0: { main: [heroicCallCode, heroicTargetCode, overlayHolderCode, heroicOverlayCode] }, 1: { main: [] } });
  }
  startDuel(session);
  if (scenario === "summon") {
    moveDuelCard(session.state, requireCard(session, heroicCallCode).uid, "hand", 0);
    moveDuelCard(session.state, requireCard(session, nonHeroicWarriorCode).uid, "graveyard", 0);
  } else {
    session.state.players[0].lifePoints = 500;
    moveDuelCard(session.state, requireCard(session, heroicCallCode).uid, "graveyard", 0);
    moveFaceUpAttack(session, requireCard(session, heroicTargetCode), 0, 0);
    const holder = moveFaceUpAttack(session, requireCard(session, overlayHolderCode), 0, 1);
    const material = moveDuelCard(session.state, requireCard(session, heroicOverlayCode).uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    holder.overlayUids.push(material.uid);
  }
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(heroicCallCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Heroic Call");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_HAND|LOCATION_GRAVE,0,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
  expect(script).toContain("e3:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("EFFECT_COUNT_CODE_OATH");
  expect(script).toContain("Cost.SelfBanish");
  expect(script).toContain("Duel.GetLP(tp)<=500");
  expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsSetCard,SET_HEROIC),tp,LOCATION_ONFIELD,0,nil)");
  expect(script).toContain("Duel.GetOverlayGroup(tp,1,0):FilterCount(Card.IsSetCard,nil,SET_HEROIC)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ct*500)");
}

function cards(): DuelCardData[] {
  return [
    { code: nonHeroicWarriorCode, name: "Heroic Call Non-Heroic Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: heroicTargetCode, name: "Heroic Call Heroic Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setHeroic], race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    { code: overlayHolderCode, name: "Heroic Call Overlay Holder", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2000, defense: 1600 },
    { code: heroicOverlayCode, name: "Heroic Call Heroic Overlay", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setHeroic], race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
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
