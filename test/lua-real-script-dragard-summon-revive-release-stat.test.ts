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
const dragardCode = "65737274";
const normalTargetCode = "657372740";
const highAttackNormalCode = "657372741";
const effectLowAttackCode = "657372742";
const dragonCostCode = "657372743";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDragardScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dragardCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeNormal = 0x10;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;
const effectUpdateAttack = 100;
const effectChangeLevel = 131;

describe.skipIf(!hasUpstreamScripts || !hasDragardScript)("Lua real script Dragard summon revive release stat", () => {
  it("restores Normal Summon revive and Dragon release-cost Level 8 ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${dragardCode}.lua`));
    const reader = createCardReader(cards());

    const restoredTrigger = createRestoredSummonTriggerWindow({ reader, workspace });
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const dragard = requireCard(restoredTrigger.session, dragardCode);
    const normalTarget = requireCard(restoredTrigger.session, normalTargetCode);
    const highAttackNormal = requireCard(restoredTrigger.session, highAttackNormalCode);
    const effectLowAttack = requireCard(restoredTrigger.session, effectLowAttackCode);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1100",
        sourceUid: dragard.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: dragard.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === dragard.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 0);
    passRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === normalTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: dragard.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === highAttackNormal.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === effectLowAttack.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["normalSummoned", "becameTarget", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: dragard.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: normalTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: normalTarget.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: dragard.uid,
        eventReasonEffectId: 1,
        eventUids: [normalTarget.uid],
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 1 },
      },
    ]);

    const restoredStat = createRestoredStatWindow({ reader, workspace });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const statDragard = requireCard(restoredStat.session, dragardCode);
    const dragonCost = requireCard(restoredStat.session, dragonCostCode);
    expect(currentLevel(statDragard, restoredStat.session.state)).toBe(4);
    expect(currentAttack(statDragard, restoredStat.session.state)).toBe(1300);
    const boost = getLuaRestoreLegalActions(restoredStat, 0).find((action) => action.type === "activateEffect" && action.uid === statDragard.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, boost!);
    expect(restoredStat.session.state.cards.find((card) => card.uid === dragonCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: statDragard.uid,
      reasonEffectId: 2,
    });
    expect(currentLevel(restoredStat.session.state.cards.find((card) => card.uid === statDragard.uid), restoredStat.session.state)).toBe(8);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === statDragard.uid), restoredStat.session.state)).toBe(2100);
    expect(restoredStat.session.state.effects.filter((effect) => effect.sourceUid === statDragard.uid && [effectUpdateAttack, effectChangeLevel].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeLevel, property: 0x400, reset: { flags: 1107169792 }, sourceUid: statDragard.uid, value: 8 },
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 1107169792 }, sourceUid: statDragard.uid, value: 800 },
    ]);
    expect(restoredStat.session.state.eventHistory.filter((event) => ["becameTarget", "released"].includes(event.eventName))).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: dragonCost.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: statDragard.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: statDragard.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredStat.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentLevel(restoredAfter.session.state.cards.find((card) => card.uid === statDragard.uid), restoredAfter.session.state)).toBe(8);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === statDragard.uid), restoredAfter.session.state)).toBe(2100);
  });
});

function createRestoredSummonTriggerWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 65737274, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [dragardCode, normalTargetCode, highAttackNormalCode, effectLowAttackCode] }, 1: { main: [] } });
  startDuel(session);

  const dragard = requireCard(session, dragardCode);
  const normalTarget = requireCard(session, normalTargetCode);
  const highAttackNormal = requireCard(session, highAttackNormalCode);
  const effectLowAttack = requireCard(session, effectLowAttackCode);
  moveDuelCard(session.state, dragard.uid, "hand", 0);
  moveDuelCard(session.state, normalTarget.uid, "graveyard", 0);
  moveDuelCard(session.state, highAttackNormal.uid, "graveyard", 0);
  moveDuelCard(session.state, effectLowAttack.uid, "graveyard", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dragardCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restoredOpen);
  expectRestoredLegalActions(restoredOpen, 0);
  const normalSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === dragard.uid);
  expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restoredOpen, normalSummon!);
  return restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
}

function createRestoredStatWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 65737275, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [dragardCode, dragonCostCode, normalTargetCode] }, 1: { main: [] } });
  startDuel(session);

  const dragard = requireCard(session, dragardCode);
  const dragonCost = requireCard(session, dragonCostCode);
  const normalTarget = requireCard(session, normalTargetCode);
  moveFaceUpAttack(session, dragonCost, 0);
  moveFaceUpAttack(session, dragard, 0);
  moveFaceUpAttack(session, normalTarget, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dragardCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("e2:SetCategory(CATEGORY_LVCHANGE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.lvcostfilter,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.lvcostfilter,1,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,s.lvfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("e1:SetValue(8)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetValue(800)");
}

function cards(): DuelCardData[] {
  return [
    { code: dragardCode, name: "Dragard", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1300, defense: 1900 },
    { code: normalTargetCode, name: "Dragard Normal Revive Target", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceWarrior, attribute: attributeLight, level: 4, attack: 800, defense: 1200 },
    { code: highAttackNormalCode, name: "Dragard High Attack Normal Decoy", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1500, defense: 1000 },
    { code: effectLowAttackCode, name: "Dragard Effect Low Attack Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 800, defense: 1000 },
    { code: dragonCostCode, name: "Dragard Dragon Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
