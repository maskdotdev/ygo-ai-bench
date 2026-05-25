import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const tellusionCode = "24431911";
const sigmaPlusCode = "51826619";
const sigmaMinusCode = "87814728";
const chainStarterCode = "244319110";
const earthTargetCode = "244319111";
const banishedPlusCode = "244319112";
const banishedMinusCode = "244319113";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTellusionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${tellusionCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceRock = 0x100;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const setMagnetWarriorSigma = 0xb066;
const categoryDestroy = 0x1;
const categorySpecialSummon = 0x200;
const categoryControl = 0x2000;
const effectFlagCardTarget = 0x10;
const effectFlagUncopyable = 0x40000;
const effectFlagCannotDisable = 0x400;

describe.skipIf(!hasUpstreamScripts || !hasTellusionScript)("Lua real script Tellusion Magna Warrior chain control summon", () => {
  it("restores procedure metadata, opponent-chain EARTH control, and opponent-turn SelfTribute banished Sigma summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${tellusionCode}.lua`));
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());

    const control = createRestoredControlField({ reader, source, workspace });
    expect(control.restored.session.state.effects.filter((effect) => effect.sourceUid === control.tellusion.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", property: effectFlagUncopyable | effectFlagCannotDisable, range: ["monsterZone"], sourceUid: control.tellusion.uid, triggerEvent: undefined },
      { category: undefined, code: 30, countLimit: undefined, event: "continuous", property: effectFlagUncopyable | effectFlagCannotDisable, range: ["monsterZone"], sourceUid: control.tellusion.uid, triggerEvent: undefined },
      { category: undefined, code: 34, countLimit: undefined, event: "summonProcedure", property: effectFlagUncopyable | effectFlagCannotDisable, range: ["graveyard"], sourceUid: control.tellusion.uid, triggerEvent: undefined },
      { category: categoryDestroy | categoryControl, code: 1027, countLimit: 1, event: "quick", property: effectFlagCardTarget, range: ["monsterZone"], sourceUid: control.tellusion.uid, triggerEvent: "chaining" },
      { category: categorySpecialSummon, code: 1002, countLimit: undefined, event: "quick", property: undefined, range: ["monsterZone"], sourceUid: control.tellusion.uid, triggerEvent: undefined },
    ]);
    const starter = getLuaRestoreLegalActions(control.restored, 1).find((action) =>
      action.type === "activateEffect" && action.uid === control.chainStarter.uid
    );
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(control.restored, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(control.restored, starter!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(control.restored.session), source, reader, { promptOverrides: yesPrompts });
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateEffect" && action.uid === control.tellusion.uid && action.effectId === "lua-4-1027"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChainOrDecline(restoredTrigger);

    expect(restoredTrigger.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 390910579, returned: true },
    ]);
    expect(findCard(restoredTrigger.session, control.earthTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: control.tellusion.uid,
      reasonEffectId: 4,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["chaining", "becameTarget", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      previousController: event.eventPreviousState?.controller,
      currentLocation: event.eventCurrentState?.location,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "chaining", eventCode: 1027, eventCardUid: control.chainStarter.uid, eventPlayer: 1, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 6, previousLocation: "deck", previousController: 1, currentLocation: "hand", currentController: 1 },
      { eventName: "chaining", eventCode: 1027, eventCardUid: control.tellusion.uid, eventPlayer: 0, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4, previousLocation: "deck", previousController: 0, currentLocation: "monsterZone", currentController: 0 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: control.earthTarget.uid, eventPlayer: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4, previousLocation: "deck", previousController: 1, currentLocation: "monsterZone", currentController: 1 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: control.earthTarget.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: control.tellusion.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previousLocation: "monsterZone", previousController: 1, currentLocation: "monsterZone", currentController: 0 },
    ]);

    const summon = createRestoredSummonField({ reader, source, workspace });
    const quickSummon = getLuaRestoreLegalActions(summon.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === summon.tellusion.uid && action.effectId === "lua-5-1002"
    );
    expect(quickSummon, JSON.stringify(getLuaRestoreLegalActions(summon.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(summon.restored, quickSummon!);
    passRestoredChain(summon.restored);

    expect(findCard(summon.restored.session, summon.tellusion.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: summon.tellusion.uid,
      reasonEffectId: 5,
    });
    for (const sigma of [summon.banishedPlus, summon.banishedMinus]) {
      expect(findCard(summon.restored.session, sigma.uid)).toMatchObject({
        location: "monsterZone",
        controller: 0,
        faceUp: true,
        reason: duelReason.summon | duelReason.specialSummon,
        reasonPlayer: 0,
        reasonCardUid: summon.tellusion.uid,
        reasonEffectId: 5,
      });
    }
    expect(summon.restored.session.state.eventHistory.filter((event) => ["released", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: summon.tellusion.uid, eventReason: duelReason.release | duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: summon.tellusion.uid, eventReasonEffectId: 5, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: summon.banishedPlus.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: summon.tellusion.uid, eventReasonEffectId: 5, previousLocation: "banished", currentLocation: "monsterZone" },
    ]);
  });
});

const yesPrompts = [{ api: "SelectYesNo" as const, player: 0 as const, returned: true }];

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Tellusion the Magna Warrior");
  expect(script).toContain("e0:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,2,2,s.rescon,1,tp,HINTMSG_REMOVE,nil,nil,true)");
  expect(script).toContain("Duel.Remove(sg,POS_FACEUP,REASON_COST)");
  expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,tc,1,tp,0)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_CONTROL,tc,1,tp,0)");
  expect(script).toContain("Duel.GetControl(tc,tp)");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
  expect(script).toContain("e2:SetCost(Cost.SelfTribute)");
  expect(script).toContain("Duel.IsPlayerAffectedByEffect(tp,CARD_BLUEEYES_SPIRIT)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.rmspfilter,tp,LOCATION_REMOVED,0,2,2,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
}

type ScriptSource = { readScript(name: string): string | undefined };

function createRestoredControlField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ScriptSource;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}) {
  const session = createDuel({ seed: 24431911, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [tellusionCode] }, 1: { main: [chainStarterCode, earthTargetCode] } });
  startDuel(session);
  const tellusion = requireCard(session, tellusionCode);
  const chainStarter = requireCard(session, chainStarterCode);
  const earthTarget = requireCard(session, earthTargetCode);
  moveFaceUpAttack(session, tellusion, 0, 0);
  moveFaceUpAttack(session, earthTarget, 1, 0);
  moveDuelCard(session.state, chainStarter.uid, "hand", 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const restored = registerAndRestore(session, source, workspace, reader, 2, yesPrompts);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 1);
  return { restored, tellusion, chainStarter, earthTarget };
}

function createRestoredSummonField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ScriptSource;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}) {
  const session = createDuel({ seed: 24431912, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [tellusionCode, banishedPlusCode, banishedMinusCode] }, 1: { main: [] } });
  startDuel(session);
  const tellusion = requireCard(session, tellusionCode);
  const banishedPlus = requireCard(session, banishedPlusCode);
  const banishedMinus = requireCard(session, banishedMinusCode);
  moveFaceUpAttack(session, tellusion, 0, 0);
  moveDuelCard(session.state, banishedPlus.uid, "banished", 0);
  banishedPlus.faceUp = true;
  moveDuelCard(session.state, banishedMinus.uid, "banished", 0);
  banishedMinus.faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 0;
  const restored = registerAndRestore(session, source, workspace, reader, 1);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return { restored, tellusion, banishedPlus, banishedMinus };
}

function registerAndRestore(
  session: DuelSession,
  source: ScriptSource,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
  expectedRegistered: number,
  promptOverrides?: typeof yesPrompts,
) {
  const host = createLuaScriptHost(session, workspace, promptOverrides ? { promptOverrides } : undefined);
  expect(host.loadCardScript(Number(tellusionCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(chainStarterCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(expectedRegistered);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader, promptOverrides ? { promptOverrides } : undefined);
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ScriptSource {
  return {
    readScript(name: string) {
      if (name === `c${chainStarterCode}.lua`) return chainStarterScript();
      return workspace.readScript(name) ?? workspace.readScript(`official/${name}`);
    },
  };
}

function chainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("tellusion chain starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function cards(): DuelCardData[] {
  return [
    sigmaMonster(tellusionCode, "Tellusion the Magna Warrior", 2500),
    sigmaMonster(sigmaPlusCode, "Magnet Warrior Sigma Plus", 1800),
    sigmaMonster(sigmaMinusCode, "Magnet Warrior Sigma Minus", 1800),
    sigmaMonster(banishedPlusCode, "Tellusion Banished Sigma Plus", 1400),
    sigmaMonster(banishedMinusCode, "Tellusion Banished Sigma Minus", 1400),
    { code: chainStarterCode, name: "Tellusion Chain Starter", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: earthTargetCode, name: "Tellusion Earth Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
  ];
}

function sigmaMonster(code: string, name: string, attack: number): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typeEffect,
    race: raceRock,
    attribute: attributeEarth,
    level: 8,
    attack,
    defense: 2000,
    setcodes: [setMagnetWarriorSigma],
  };
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passRestoredChainOrDecline(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const actions = getLuaRestoreLegalActions(restored, player);
    const action = actions.find((candidate) => candidate.type === "passChain") ?? actions.find((candidate) => candidate.type === "declineTrigger");
    expect(action, JSON.stringify(actions, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
}
