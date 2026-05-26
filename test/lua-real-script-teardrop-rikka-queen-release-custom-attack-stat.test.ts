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
const teardropCode = "33779875";
const plantMaterialCode = "337798750";
const releaseTargetCode = "337798751";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTeardropScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${teardropCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const racePlant = 0x400;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeLight = 0x10;
const eventRelease = 1017;
const eventCustomTeardrop = 0x10000000 + Number(teardropCode);

describe.skipIf(!hasUpstreamScripts || !hasTeardropScript)("Lua real script Teardrop Rikka Queen release custom attack stat", () => {
  it("restores Plant-material quick detach release into custom EVENT_RELEASE ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${teardropCode}.lua`);
    expectTeardropScriptShape(script);
    const reader = createCardReader(cards());

    const restoredOpen = createRestoredReleaseWindow({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const teardrop = requireCard(restoredOpen.session, teardropCode);
    const plantMaterial = requireCard(restoredOpen.session, plantMaterialCode);
    const releaseTarget = requireCard(restoredOpen.session, releaseTargetCode);
    expect(currentAttack(teardrop, restoredOpen.session.state)).toBe(2800);
    expect(teardrop.overlayUids).toEqual([plantMaterial.uid]);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === teardrop.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"] },
      { category: 2, code: undefined, event: "ignition", property: 16, range: ["monsterZone"] },
      { category: 2, code: 1002, event: "quick", property: 16, range: ["monsterZone"] },
      { category: 2097152, code: eventCustomTeardrop, event: "trigger", property: undefined, range: ["monsterZone"] },
      { category: undefined, code: eventRelease, event: "continuous", property: 1024, range: ["monsterZone"] },
    ]);

    const release = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === teardrop.uid);
    expect(release, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, release!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === plantMaterial.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: teardrop.uid,
      reasonEffectId: 3,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === releaseTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: teardrop.uid,
      reasonEffectId: 3,
    });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      eventValue: trigger.eventValue,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-4-302215331",
        eventCardUid: teardrop.uid,
        eventCode: eventCustomTeardrop,
        eventName: "customEvent",
        eventPlayer: 0,
        eventReason: duelReason.release | duelReason.effect,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        eventValue: 1,
        player: 0,
        sourceUid: teardrop.uid,
        triggerBucket: "turnMandatory",
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["detachedMaterial", "becameTarget", "released", "customEvent"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventValue: event.eventValue,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: plantMaterial.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: teardrop.uid, eventReasonEffectId: 3, eventValue: undefined, relatedEffectId: undefined, previous: "overlay", current: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: releaseTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventValue:  1, relatedEffectId: 3, previous: "deck", current: "monsterZone" },
      { eventName: "released", eventCode: eventRelease, eventCardUid: releaseTarget.uid, eventReason: duelReason.release | duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: teardrop.uid, eventReasonEffectId: 3, eventValue: undefined, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "customEvent", eventCode: eventCustomTeardrop, eventCardUid: teardrop.uid, eventReason: duelReason.release | duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventValue: 1, relatedEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const boost = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === teardrop.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, boost!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === teardrop.uid), restoredTrigger.session.state)).toBe(3000);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === teardrop.uid)).toMatchObject({ attackModifier: 200 });
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredReleaseWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 33779875, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [plantMaterialCode, releaseTargetCode], extra: [teardropCode] }, 1: { main: [] } });
  startDuel(session);
  const teardrop = requireCard(session, teardropCode);
  const plantMaterial = requireCard(session, plantMaterialCode);
  moveFaceUpAttack(session, requireCard(session, releaseTargetCode), 0, 0);
  moveFaceUpAttack(session, teardrop, 0, 1);
  moveDuelCard(session.state, plantMaterial.uid, "overlay", 0);
  teardrop.overlayUids.push(plantMaterial.uid);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(teardropCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectTeardropScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Xyz.AddProcedure(c,nil,8,2)");
  expect(script).toContain("e1a:SetCategory(CATEGORY_RELEASE)");
  expect(script).toContain("e1a:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1a:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("e1b:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1b:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("return e:GetHandler():GetOverlayGroup():IsExists(Card.IsRace,1,nil,RACE_PLANT)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsReleasableByEffect,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_RELEASE,g,1,tp,0)");
  expect(script).toContain("Duel.Release(tc,REASON_EFFECT)");
  expect(script).toContain("e2a:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2a:SetCode(EVENT_CUSTOM+id)");
  expect(script).toContain("e2b:SetCode(EVENT_RELEASE)");
  expect(script).toContain("Duel.RaiseSingleEvent(e:GetHandler(),EVENT_CUSTOM+id,re,r,rp,ep,ct)");
  expect(script).toContain("c:UpdateAttack(ev*200,RESETS_STANDARD_DISABLE_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: teardropCode, name: "Teardrop the Rikka Queen", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: racePlant, attribute: attributeWater, level: 8, attack: 2800, defense: 2800 },
    { code: plantMaterialCode, name: "Teardrop Plant Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeWater, level: 8, attack: 1000, defense: 1000 },
    { code: releaseTargetCode, name: "Teardrop LIGHT Release Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
