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
const puppetQueenCode = "15001619";
const gaiaCode = "3167573";
const allyWarriorCode = "150016190";
const tributeFodderCode = "150016191";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPuppetQueenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${puppetQueenCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeNormal = 0x10;
const raceWarrior = 0x1;
const raceSpellcaster = 0x2;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const effectCannotDisable = 0x400;

describe.skipIf(!hasUpstreamScripts || !hasPuppetQueenScript)("Lua real script Puppet Queen summon Gaia attack stat", () => {
  it("restores summon trigger into Gaia special summon and EARTH Warrior ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${puppetQueenCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredPuppetQueenOpen({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const puppetQueen = requireCard(restoredOpen.session, puppetQueenCode);
    const tributeFodder = requireCard(restoredOpen.session, tributeFodderCode);
    const tributeSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "tributeSummon" && action.uid === puppetQueen.uid && action.tributeUids.includes(tributeFodder.uid)
    );
    expect(tributeSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, tributeSummon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === puppetQueen.uid && action.effectId === "lua-2-1100"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    const gaia = requireCard(restoredTrigger.session, gaiaCode);
    const allyWarrior = requireCard(restoredTrigger.session, allyWarriorCode);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === gaia.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: puppetQueen.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === puppetQueen.uid), restoredTrigger.session.state)).toBe(3200);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === gaia.uid), restoredTrigger.session.state)).toBe(3300);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === allyWarrior.uid), restoredTrigger.session.state)).toBe(2500);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.code === effectUpdateAttack && [puppetQueen.uid, gaia.uid, allyWarrior.uid].includes(effect.sourceUid)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: effectCannotDisable, reset: { count: 2, flags: 1107169792 }, sourceUid: allyWarrior.uid, targetRange: undefined, value: 1000 },
      { code: effectUpdateAttack, property: effectCannotDisable, reset: { count: 2, flags: 1107169792 }, sourceUid: puppetQueen.uid, targetRange: undefined, value: 1000 },
      { code: effectUpdateAttack, property: effectCannotDisable, reset: { count: 2, flags: 1107169792 }, sourceUid: gaia.uid, targetRange: undefined, value: 1000 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: puppetQueen.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "hand", current: "monsterZone" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: gaia.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: puppetQueen.uid, eventReasonEffectId: 2, previous: "graveyard", current: "monsterZone" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: puppetQueenCode, name: "Puppet Queen", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 6, attack: 2200, defense: 2500 },
    { code: gaiaCode, name: "Gaia The Fierce Knight", kind: "monster", typeFlags: typeMonster | typeNormal, race: raceWarrior, attribute: attributeEarth, level: 7, attack: 2300, defense: 2100 },
    { code: allyWarriorCode, name: "Puppet Queen Ally Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
    { code: tributeFodderCode, name: "Puppet Queen Tribute Fodder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeEarth, level: 4, attack: 800, defense: 1000 },
  ];
}

function createRestoredPuppetQueenOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 15001619, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [puppetQueenCode, gaiaCode, allyWarriorCode, tributeFodderCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, puppetQueenCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, gaiaCode).uid, "graveyard", 0);
  moveFaceUpAttack(session, requireCard(session, allyWarriorCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, tributeFodderCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(puppetQueenCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Puppet Queen");
  expect(script).toContain("e1:SetCode(EVENT_TOHAND_CONFIRM)");
  expect(script).toContain("c:IsPreviousLocation(LOCATION_DECK) and not c:IsReason(REASON_DRAW)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsLevel(7) and c:IsRace(RACE_WARRIOR) and c:IsAttribute(ATTRIBUTE_EARTH)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spfilter),tp,LOCATION_GRAVE|LOCATION_HAND,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.GetMatchingGroup(s.atkfilter,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
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
  while (restored.session.state.chain.length > 0 && guard < 10) {
    guard += 1;
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
  expect(guard).toBeLessThan(10);
}
