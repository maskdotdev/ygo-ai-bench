import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { statusProcComplete } from "#duel/procedure-status.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const collapseCode = "36197902";
const costCode = "361979020";
const linkTargetCode = "361979021";
const destroyedLinkCode = "361979022";
const cyberseLinkCode = "361979023";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCollapseScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${collapseCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const typeLink = 0x4000000;
const raceWarrior = 0x1;
const raceCyberse = 0x1000000;
const attributeLight = 0x10;
const attributeDark = 0x20;
const setWorldLegacy = 0xfe;
const eventDestroyed = 1029;
const effectUpdateAttack = 100;
const resetEventStandard = 33427456;
const resetPhaseEnd = 1073742336;
const chooseAtkBranch = [{ api: "SelectYesNo" as const, player: 0 as const, returned: true }];

describe.skipIf(!hasUpstreamScripts || !hasCollapseScript)("Lua real script World Legacy Collapse activate stat destroyed summon", () => {
  it("restores activation-time World Legacy banish ATK gain and destroyed Link grave summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectCollapseScriptShape(workspace.readScript(`official/c${collapseCode}.lua`));
    const reader = createCardReader(cards());

    const restoredActivation = createRestoredActivationField({ reader, workspace });
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const collapse = requireCard(restoredActivation.session, collapseCode);
    const cost = requireCard(restoredActivation.session, costCode);
    const linkTarget = requireCard(restoredActivation.session, linkTargetCode);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) =>
      action.type === "activateEffect" && action.uid === collapse.uid && action.effectId === "lua-1-1002",
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivation, activation!);
    resolveRestoredChain(restoredActivation);
    expect(restoredActivation.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 94, returned: true },
    ]);
    expect(restoredActivation.session.state.cards.find((card) => card.uid === collapse.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
    });
    expect(restoredActivation.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: collapse.uid,
      reasonEffectId: 1,
    });
    expect(restoredActivation.session.state.flagEffects.filter((flag) => flag.ownerType === "player" && flag.ownerId === "0" && flag.code === Number(collapseCode))).toEqual([
      { ownerType: "player", ownerId: "0", code: Number(collapseCode), reset: resetPhaseEnd, resetCount: 1, property: 0, value: 0, turn: 1 },
    ]);
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === linkTarget.uid), restoredActivation.session.state)).toBe(3200);
    expect(restoredActivation.session.state.effects.filter((effect) => effect.sourceUid === linkTarget.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, registryKey: `lua:${collapseCode}:lua-4-100`, reset: { flags: resetEventStandard }, sourceUid: linkTarget.uid, value: 1200 },
    ]);
    expect(restoredActivation.session.state.eventHistory.filter((event) => ["banished", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: cost.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: collapse.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "graveyard", current: "banished" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: linkTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, previous: "extraDeck", current: "monsterZone" },
    ]);

    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader, { promptOverrides: chooseAtkBranch });
    expectCleanRestore(restoredPersistent);
    expectRestoredLegalActions(restoredPersistent, 0);
    expect(currentAttack(restoredPersistent.session.state.cards.find((card) => card.uid === linkTarget.uid), restoredPersistent.session.state)).toBe(3200);
    expect(getLuaRestoreLegalActions(restoredPersistent, 0).some((action) =>
      action.type === "activateEffect" && action.uid === collapse.uid && action.effectId === "lua-2-1002",
    )).toBe(false);

    const restoredDestroyed = createRestoredDestroyedField({ reader, workspace });
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    const graveCollapse = requireCard(restoredDestroyed.session, collapseCode);
    const destroyedLink = requireCard(restoredDestroyed.session, destroyedLinkCode);
    const cyberseLink = requireCard(restoredDestroyed.session, cyberseLinkCode);
    destroyDuelCard(restoredDestroyed.session.state, destroyedLink.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredDestroyed.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1029", eventCardUid: destroyedLink.uid, eventCode: eventDestroyed, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, player: 0, sourceUid: graveCollapse.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyed.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === graveCollapse.uid && action.effectId === "lua-3-1029",
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === graveCollapse.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveCollapse.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === cyberseLink.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: graveCollapse.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard", "banished", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
      { eventName: "destroyed", eventCode: eventDestroyed, eventCardUid: destroyedLink.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: destroyedLink.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "banished", eventCode: 1011, eventCardUid: graveCollapse.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: graveCollapse.uid, eventReasonEffectId: 3, previous: "graveyard", current: "banished" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: cyberseLink.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: graveCollapse.uid, eventReasonEffectId: 3, previous: "graveyard", current: "monsterZone" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredActivationField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 36197902, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [collapseCode, costCode], extra: [linkTargetCode] }, 1: { main: [] } });
  startDuel(session);
  const collapse = requireCard(session, collapseCode);
  moveDuelCard(session.state, collapse.uid, "spellTrapZone", 0);
  collapse.faceUp = false;
  collapse.position = "faceDown";
  moveDuelCard(session.state, requireCard(session, costCode).uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, requireCard(session, linkTargetCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace, { promptOverrides: chooseAtkBranch });
  expect(host.loadCardScript(Number(collapseCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides: chooseAtkBranch });
}

function createRestoredDestroyedField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 36197903, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [collapseCode], extra: [destroyedLinkCode, cyberseLinkCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, collapseCode).uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, requireCard(session, destroyedLinkCode), 0, 0);
  const cyberseLink = moveDuelCard(session.state, requireCard(session, cyberseLinkCode).uid, "graveyard", 0);
  cyberseLink.faceUp = true;
  cyberseLink.customStatusMask = statusProcComplete;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(collapseCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectCollapseScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("World Legacy Collapse");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetTarget(s.target)");
  expect(script).toContain("if s.atkcost(e,tp,eg,ep,ev,re,r,rp,0) and s.atktg(e,tp,eg,ep,ev,re,r,rp,0) and Duel.SelectYesNo(tp,94) then");
  expect(script).toContain("e:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("s.atkcost(e,tp,eg,ep,ev,re,r,rp,1)");
  expect(script).toContain("return c:IsMonster() and c:IsSetCard(SET_WORLD_LEGACY) and c:GetBaseAttack()>0");
  expect(script).toContain("and c:IsAbleToRemoveAsCost() and (aux.SpElimFilter(c,true,true) or c:IsLocation(LOCATION_HAND))");
  expect(script).toContain("return c:IsFaceup() and c:IsLinkMonster()");
  expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,0,1)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel())");
  expect(script).toContain("e3:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("e3:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e3:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return eg:IsExists(s.spcfilter,1,nil,tp)");
  expect(script).toContain("return c:IsRace(RACE_CYBERSE) and c:IsLinkMonster() and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spfilter),tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: collapseCode, name: "World Legacy Collapse", kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: costCode, name: "World Legacy Collapse Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1200, defense: 1000, setcodes: [setWorldLegacy] },
    { code: linkTargetCode, name: "World Legacy Collapse Link Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceWarrior, attribute: attributeLight, level: 2, attack: 2000, defense: 0, linkMarkers: 0x28 },
    { code: destroyedLinkCode, name: "World Legacy Collapse Destroyed Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceWarrior, attribute: attributeLight, level: 2, attack: 1800, defense: 0, linkMarkers: 0x28 },
    { code: cyberseLinkCode, name: "World Legacy Collapse Cyberse Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 2, attack: 1600, defense: 0, linkMarkers: 0x28 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
