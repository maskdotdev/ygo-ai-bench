import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cardTypeFlags, currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel, xyzSummonDuelCard } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost, type LuaScriptSource } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const skullEagleCode = "45184165";
const partnerCode = "451841650";
const xyzCode = "451841651";
const recoveryTargetCode = "451841652";
const detachXyzCode = "451841653";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSkullEagleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${skullEagleCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceWingedBeast = 0x80;
const attributeDark = 0x20;
const setRaidraptor = 0xba;
const effectAddType = 115;
const effectUpdateAttack = 100;
const eventBeMaterial = 1108;
const eventSpecialSummonSuccess = 1102;

describe.skipIf(!hasUpstreamScripts || !hasSkullEagleScript)("Lua real script Raidraptor Skull Eagle material detach to-hand stat", () => {
  it("restores Xyz material granted ATK/type and detached self-banish GY recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${skullEagleCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const grant = createMaterialGrantScenario(workspace, reader);
    expectRestoredLegalActions(grant.restored, 0);
    xyzSummonDuelCard(grant.restored.session.state, 0, grant.xyz.uid, [grant.skullEagle.uid, grant.partner.uid]);
    expect(findCard(grant.restored.session, grant.skullEagle.uid)).toMatchObject({
      location: "overlay",
      reason: duelReason.material | duelReason.xyz,
      reasonCardUid: grant.xyz.uid,
    });
    expect(grant.restored.session.state.eventHistory.filter((event) =>
      ["usedAsMaterial", "specialSummoned"].includes(event.eventName)
    ).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
    }))).toEqual([
      { current: "overlay", eventCardUid: grant.skullEagle.uid, eventCode: eventBeMaterial, eventName: "usedAsMaterial", eventReason: duelReason.xyz, eventReasonCardUid: grant.xyz.uid, eventReasonPlayer: 0, previous: "monsterZone" },
      { current: "overlay", eventCardUid: grant.partner.uid, eventCode: eventBeMaterial, eventName: "usedAsMaterial", eventReason: duelReason.xyz, eventReasonCardUid: grant.xyz.uid, eventReasonPlayer: 0, previous: "monsterZone" },
      { current: "monsterZone", eventCardUid: grant.xyz.uid, eventCode: eventSpecialSummonSuccess, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon | duelReason.xyz, eventReasonCardUid: undefined, eventReasonPlayer: 0, previous: "extraDeck" },
    ]);
    expect(cardTypeFlags(findCard(grant.restored.session, grant.xyz.uid), grant.restored.session.state) & typeEffect).toBe(typeEffect);
    expect(grant.restored.session.state.effects.find((effect) => effect.sourceUid === grant.xyz.uid && effect.code === effectAddType)).toMatchObject({
      code: effectAddType,
      value: typeEffect,
    });
    const boost = getLuaRestoreLegalActions(grant.restored, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === grant.xyz.uid
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(grant.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(grant.restored, boost!);
    resolveRestoredChain(grant.restored);
    expect(currentAttack(findCard(grant.restored.session, grant.xyz.uid), grant.restored.session.state)).toBe(2300);
    expect(grant.restored.session.state.effects.filter((effect) =>
      effect.sourceUid === grant.xyz.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: effectUpdateAttack, reset: { flags: 33492992 }, sourceUid: grant.xyz.uid, value: 300 }]);
    expect(grant.restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const detach = createDetachedRecoveryScenario(workspace, reader);
    expectRestoredLegalActions(detach.restored, 0);
    const detachEffect = getLuaRestoreLegalActions(detach.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === detach.detachXyz.uid && action.effectId === "lua-3"
    );
    expect(detachEffect, JSON.stringify(getLuaRestoreLegalActions(detach.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(detach.restored, detachEffect!);
    resolveRestoredChain(detach.restored);
    expect(findCard(detach.restored.session, detach.skullEagle.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: detach.detachXyz.uid,
      reasonEffectId: 3,
    });

    const triggerWindow = restoreDuelWithLuaScripts(serializeDuel(detach.restored.session), detach.source, reader);
    expectCleanRestore(triggerWindow);
    expectRestoredLegalActions(triggerWindow, 0);
    const recover = getLuaRestoreLegalActions(triggerWindow, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === detach.skullEagle.uid && action.effectId === "lua-1-1014"
    );
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(triggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(triggerWindow, recover!);
    expect(findCard(triggerWindow.session, detach.skullEagle.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: detach.skullEagle.uid,
      reasonEffectId: 1,
    });
    resolveRestoredChain(triggerWindow);
    expect(findCard(triggerWindow.session, detach.recoveryTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: detach.skullEagle.uid,
      reasonEffectId: 1,
    });
    expect(triggerWindow.session.state.eventHistory.filter((event) =>
      ["detachedMaterial", "banished", "becameTarget", "sentToHand"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: detach.skullEagle.uid, eventCode: 1202, eventName: "detachedMaterial", eventReason: duelReason.cost, eventReasonCardUid: detach.detachXyz.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "overlay", current: "graveyard", relatedEffectId: undefined },
      { eventCardUid: detach.skullEagle.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: detach.skullEagle.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "graveyard", current: "banished", relatedEffectId: undefined },
      { eventCardUid: detach.recoveryTarget.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", current: "graveyard", relatedEffectId: 1 },
      { eventCardUid: detach.recoveryTarget.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: detach.skullEagle.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "graveyard", current: "hand", relatedEffectId: undefined },
    ]);
    expect(triggerWindow.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createMaterialGrantScenario(
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
): { restored: ReturnType<typeof restoreDuelWithLuaScripts>; skullEagle: DuelCardInstance; partner: DuelCardInstance; xyz: DuelCardInstance } {
  const session = createDuel({ seed: 45184165, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [skullEagleCode, partnerCode], extra: [xyzCode] }, 1: { main: [] } });
  startDuel(session);
  const skullEagle = requireCard(session, skullEagleCode);
  const partner = requireCard(session, partnerCode);
  const xyz = requireCard(session, xyzCode);
  moveFaceUpAttack(session, skullEagle, 0, 0);
  moveFaceUpAttack(session, partner, 0, 1);
  prepareOpenState(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(skullEagleCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restored);
  return { restored, skullEagle, partner, xyz };
}

function createDetachedRecoveryScenario(
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
): {
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
  source: LuaScriptSource;
  skullEagle: DuelCardInstance;
  recoveryTarget: DuelCardInstance;
  detachXyz: DuelCardInstance;
} {
  const session = createDuel({ seed: 45184166, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [skullEagleCode, recoveryTargetCode], extra: [detachXyzCode] }, 1: { main: [] } });
  startDuel(session);
  const skullEagle = requireCard(session, skullEagleCode);
  const recoveryTarget = requireCard(session, recoveryTargetCode);
  const detachXyz = requireCard(session, detachXyzCode);
  moveFaceUpAttack(session, detachXyz, 0, 0);
  moveDuelCard(session.state, skullEagle.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0).sequence = 0;
  detachXyz.overlayUids.push(skullEagle.uid);
  moveDuelCard(session.state, recoveryTarget.uid, "graveyard", 0).faceUp = true;
  prepareOpenState(session);
  const source = helperSource(workspace);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(skullEagleCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(detachXyzCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
  expectCleanRestore(restored);
  return { restored, source, skullEagle, recoveryTarget, detachXyz };
}

function helperSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): LuaScriptSource {
  return {
    readScript(name: string): string | undefined {
      if (name === `c${detachXyzCode}.lua`) return detachXyzScript();
      return workspace.readScript(name);
    },
  };
}

function detachXyzScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_TOHAND)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetCost(Cost.DetachFromSelf(1))
      e:SetOperation(function(e,tp) Debug.Message("skull eagle detach helper resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function cards(): DuelCardData[] {
  return [
    { code: skullEagleCode, name: "Raidraptor - Skull Eagle", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeDark, level: 3, attack: 1000, defense: 500, setcodes: [setRaidraptor] },
    { code: partnerCode, name: "Skull Eagle Xyz Material", kind: "monster", typeFlags: typeMonster, race: raceWingedBeast, attribute: attributeDark, level: 3, attack: 900, defense: 900 },
    { code: xyzCode, name: "Skull Eagle Normal Raidraptor Xyz", kind: "extra", typeFlags: typeMonster | typeXyz, race: raceWingedBeast, attribute: attributeDark, level: 3, attack: 2000, defense: 1000, setcodes: [setRaidraptor], xyzMaterialCount: 2 },
    { code: recoveryTargetCode, name: "Skull Eagle Recovery Raidraptor", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeDark, level: 4, attack: 1200, defense: 800, setcodes: [setRaidraptor] },
    { code: detachXyzCode, name: "Skull Eagle Detach Helper Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWingedBeast, attribute: attributeDark, level: 3, attack: 1800, defense: 1000, setcodes: [setRaidraptor], xyzMaterialCount: 1 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Raidraptor - Skull Eagle");
  expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)");
  expect(script).toContain("c:IsReason(REASON_COST) and re:IsActivated() and re:IsActiveType(TYPE_XYZ)");
  expect(script).toContain("and c:IsPreviousLocation(LOCATION_OVERLAY)");
  expect(script).toContain("e1:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
  expect(script).toContain("e2:SetCode(EVENT_BE_MATERIAL)");
  expect(script).toContain("return r==REASON_XYZ");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsXyzSummoned()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(300)");
  expect(script).toContain("e2:SetCode(EFFECT_ADD_TYPE)");
  expect(script).toContain("e2:SetValue(TYPE_EFFECT)");
}

function prepareOpenState(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
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
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
