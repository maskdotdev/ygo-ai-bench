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
const salamanderCode = "33725002";
const utopiaCode = "337250020";
const utopiaRayVCode = "66970002";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSalamanderScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${salamanderCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceWarrior = 0x1;
const raceSpellcaster = 0x2;
const attributeLight = 0x10;
const attributeFire = 0x4;
const setUtopia = 0x107f;

describe.skipIf(!hasUpstreamScripts || !hasSalamanderScript)("Lua real script V Salamander summon Utopia revive", () => {
  it("restores normal-summon trigger target into Utopia graveyard Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${salamanderCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 33725002, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [salamanderCode, utopiaCode], extra: [utopiaRayVCode] }, 1: { main: [] } });
    startDuel(session);
    const salamander = requireCard(session, salamanderCode);
    const utopia = requireCard(session, utopiaCode);
    moveDuelCard(session.state, salamander.uid, "hand", 0);
    moveDuelCard(session.state, utopia.uid, "graveyard", 0).faceUp = true;
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(salamanderCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    applyRestoredActionAndAssert(restoredOpen, requireNormalSummon(restoredOpen, salamander.uid));
    expect(findCard(restoredOpen.session, salamander.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "normal",
    });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
    }))).toEqual([
      { effectId: "lua-1-1100", eventCardUid: salamander.uid, eventCode: 1100, eventName: "normalSummoned", eventReason: duelReason.summon, player: 0, sourceUid: salamander.uid },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    applyRestoredActionAndAssert(restoredTrigger, requireAction(restoredTrigger, salamander.uid, "activateTrigger"));
    resolveRestoredChain(restoredTrigger);
    expect(findCard(restoredTrigger.session, utopia.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: salamander.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "becameTarget", "specialSummoned"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: salamander.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "hand", current: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: utopia.uid, eventPlayer: undefined, eventValue:  1, eventUids: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, previous: "deck", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: utopia.uid, eventPlayer: undefined, eventValue: undefined, eventUids: [utopia.uid], eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: salamander.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "graveyard", current: "monsterZone" },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const salamander = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === salamanderCode);
  expect(salamander).toBeDefined();
  return [
    salamander!,
    { code: utopiaCode, name: "V Salamander Utopia Revive Target", kind: "monster", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2500, defense: 2000, setcodes: [setUtopia] },
    { code: utopiaRayVCode, name: "Number C39: Utopia Ray V", kind: "monster", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeLight, level: 5, attack: 2600, defense: 2000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--V Salamander");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("return c:IsSetCard(SET_UTOPIA) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_EQUIP)");
  expect(script).toContain("Duel.Equip(tp,c,tc,true)");
  expect(script).toContain("e1:SetCode(EFFECT_EQUIP_LIMIT)");
  expect(script).toContain("ec:RemoveOverlayCard(tp,1,1,REASON_COST)");
  expect(script).toContain("ec:NegateEffects(e:GetHandler())");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
  expect(script).toContain("Duel.Damage(1-tp,ct*1000,REASON_EFFECT)");
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

function requireNormalSummon(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string): DuelAction {
  const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  return action!;
}

function requireAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, type: DuelAction["type"]): DuelAction {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type && (candidate as { uid?: string }).uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  return action!;
}

function slimEvent(event: {
  eventName: string;
  eventCode?: number;
  eventCardUid?: string;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventUids?: string[];
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventPreviousState?: { location?: string };
  eventCurrentState?: { location?: string };
}) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventPlayer: event.eventPlayer,
    eventValue: event.eventValue,
    eventUids: event.eventUids,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    relatedEffectId: event.relatedEffectId,
    previous: event.eventPreviousState?.location,
    current: event.eventCurrentState?.location,
  };
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
