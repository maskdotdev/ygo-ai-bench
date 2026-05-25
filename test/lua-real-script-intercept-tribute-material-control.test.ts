import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost, type LuaScriptSource } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const interceptCode = "59695933";
const tributeSummonedCode = "596959330";
const tributeMaterialCode = "596959331";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasInterceptScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${interceptCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const categoryControl = 0x2000;
const eventSummonSuccess = 1100;
const effectMaterialCheck = 251;
const effectFlagCannotDisable = 0x400;
const effectFlagSetAvailable = 0x100;
const effectFlagIgnoreRange = 0x20;
const effectFlagCardTarget = 0x10;
const allLocations = ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"];

describe.skipIf(!hasUpstreamScripts || !hasInterceptScript)("Lua real script Intercept tribute material control", () => {
  it("restores material-check-marked Tribute Summon into Trap control of the summoned monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${interceptCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 59695933, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [interceptCode] }, 1: { main: [tributeSummonedCode, tributeMaterialCode] } });
    startDuel(session);

    const intercept = requireCard(session, interceptCode);
    const tributeSummoned = requireCard(session, tributeSummonedCode);
    const tributeMaterial = requireCard(session, tributeMaterialCode);
    setTrap(session, intercept);
    moveDuelCard(session.state, tributeSummoned.uid, "hand", 1);
    moveFaceUpAttack(session, tributeMaterial, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    const source = withSummonStarter(workspace);
    expect(host.loadCardScript(Number(interceptCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(tributeSummonedCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.filter((effect) => [intercept.uid, undefined].includes(effect.sourceUid)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { code: eventSummonSuccess, event: "quick", id: `lua-1-${eventSummonSuccess}`, property: effectFlagCardTarget, range: ["spellTrapZone"], sourceUid: intercept.uid, triggerEvent: "normalSummoned" },
      { code: effectMaterialCheck, event: "continuous", id: `lua-2-${effectMaterialCheck}`, property: effectFlagCannotDisable | effectFlagSetAvailable | effectFlagIgnoreRange, range: allLocations, sourceUid: intercept.uid, triggerEvent: undefined },
    ]);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredSummon);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.code === effectMaterialCheck).map((effect) => ({
      code: effect.code,
      id: effect.id,
      property: effect.property,
      sourceUid: effect.sourceUid,
    }))).toEqual([{ code: effectMaterialCheck, id: `lua-2-${effectMaterialCheck}`, property: effectFlagCannotDisable | effectFlagSetAvailable | effectFlagIgnoreRange, sourceUid: intercept.uid }]);
    expectRestoredLegalActions(restoredSummon, 1);
    const tributeSummon = getLuaRestoreLegalActions(restoredSummon, 1).find((action): action is Extract<DuelAction, { type: "tributeSummon" }> =>
      action.type === "tributeSummon" && action.uid === tributeSummoned.uid && action.tributeUids.includes(tributeMaterial.uid)
    );
    expect(tributeSummon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, tributeSummon!);
    expect(restoredSummon.session.state.pendingTriggers.map((trigger) => ({
      eventCardUid: trigger.eventCardUid,
      eventName: trigger.eventName,
      sourceUid: trigger.sourceUid,
    }))).toEqual([{ eventCardUid: tributeSummoned.uid, eventName: "normalSummoned", sourceUid: tributeSummoned.uid }]);
    expect(findCard(restoredSummon.session, tributeSummoned.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      summonType: "tribute",
      summonMaterialUids: [tributeMaterial.uid],
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 1);
    const starter = getLuaRestoreLegalActions(restoredTrigger, 1).find((action) =>
      action.type === "activateTrigger" && action.uid === tributeSummoned.uid
    );
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, starter!);

    const restored = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restored);
    const responseActions = getLuaRestoreLegalActions(restored, 0);
    const activate = responseActions.find((action) =>
      action.type === "activateEffect" && action.uid === intercept.uid && action.effectId === `lua-1-${eventSummonSuccess}`
    );
    expect(activate, JSON.stringify(responseActions, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, intercept.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(findCard(restored.session, tributeSummoned.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: intercept.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === tributeSummoned.uid)).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: tributeSummoned.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: intercept.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { controller: 0, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["sentToGraveyard", "normalSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCardUid: tributeMaterial.uid, eventReason: duelReason.release | duelReason.summon, eventReasonPlayer: 1, previous: "monsterZone", current: "graveyard" },
      { eventName: "normalSummoned", eventCardUid: tributeSummoned.uid, eventReason: duelReason.summon, eventReasonPlayer: 1, previous: "hand", current: "monsterZone" },
      { eventName: "sentToGraveyard", eventCardUid: intercept.uid, eventReason: duelReason.rule, eventReasonPlayer: 0, previous: "spellTrapZone", current: "graveyard" },
    ]);
  });
});

function withSummonStarter(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): LuaScriptSource {
  return {
    readScript(name) {
      if (name === `c${tributeSummonedCode}.lua`) return summonStarterScript();
      return workspace.readScript(name);
    },
  };
}

function summonStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_SUMMON_SUCCESS)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e,tp,eg) return eg:IsContains(e:GetHandler()) end)
      e:SetOperation(function(e,tp) Debug.Message("intercept summon starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function cards(): DuelCardData[] {
  return [
    { code: interceptCode, name: "Intercept", kind: "trap", typeFlags: typeTrap },
    { code: tributeSummonedCode, name: "Intercept Tribute Summoned Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 5, normalTributes: 1, attack: 2100, defense: 1600 },
    { code: tributeMaterialCode, name: "Intercept Tribute Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1200 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Intercept");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("aux.GlobalCheck(s,function()");
  expect(script).toContain("ge1:SetCode(EFFECT_MATERIAL_CHECK)");
  expect(script).toContain("ge1:SetValue(s.valcheck)");
  expect(script).toContain("c:RegisterFlagEffect(id,0,0,0)");
  expect(script).toContain("tc:IsTributeSummoned() and tc:GetFlagEffect(id)~=0");
  expect(script).toContain("tc:ResetFlagEffect(id)");
  expect(script).toContain("Duel.SetTargetCard(eg)");
  expect(script).toContain("Duel.GetControl(tc,tp)");
}

function setTrap(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
  moved.turnId = 0;
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
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
