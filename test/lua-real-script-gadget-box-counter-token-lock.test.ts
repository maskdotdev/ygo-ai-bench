import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDuelCardCounter } from "#duel/counters.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const gadgetBoxCode = "8025950";
const tokenCode = "8025951";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGadgetBoxScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gadgetBoxCode}.lua`));
const counterMorph = 0x8;
const effectCannotSpecialSummon = 22;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const typeNormal = 0x10;
const typeToken = 0x4000;
const raceMachine = 0x20;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasGadgetBoxScript)("Lua real script Gadget Box counter token lock", () => {
  it("restores activation Morph Counters into token SpecialSummonStep and Extra Deck summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gadgetBoxCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 8025950, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gadgetBoxCode] }, 1: { main: [] } });
    startDuel(session);
    moveDuelCard(session.state, requireCard(session, gadgetBoxCode).uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gadgetBoxCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const gadgetBox = requireCard(restoredOpen.session, gadgetBoxCode);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === gadgetBox.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);
    expect(getDuelCardCounter(findCard(restoredOpen.session, gadgetBox.uid), counterMorph)).toBe(3);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const summonToken = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === gadgetBox.uid);
    expect(summonToken, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, summonToken!);
    resolveRestoredChain(restoredIgnition);

    const token = restoredIgnition.session.state.cards.find((card) => card.code === tokenCode);
    expect(token).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: gadgetBox.uid,
      reasonEffectId: 3,
    });
    expect(getDuelCardCounter(findCard(restoredIgnition.session, gadgetBox.uid), counterMorph)).toBe(2);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.sourceUid === token!.uid && effect.code === effectCannotSpecialSummon).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: effectCannotSpecialSummon, property: 0x800, range: ["monsterZone"], reset: { flags: 33427456 }, sourceUid: token!.uid, targetRange: [1, 0] },
    ]);
    expect(restoredIgnition.session.state.eventHistory.filter((event) => ["counterAdded", "counterRemoved", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: gadgetBox.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: gadgetBox.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: gadgetBox.uid, eventCode: 0x20000, eventName: "counterRemoved", eventReason: duelReason.effect, eventReasonCardUid: gadgetBox.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventCardUid: token!.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: gadgetBox.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: gadgetBoxCode, name: "Gadget Box", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: tokenCode, name: "Gadget Box Token", kind: "monster", typeFlags: typeMonster | typeNormal | typeToken, race: raceMachine, attribute: attributeEarth, level: 1, attack: 0, defense: 0 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("c:EnableCounterPermit(0x8)");
  expect(script).toContain("e0:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e0:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e0:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("e:GetHandler():AddCounter(0x8,3)");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_TOKEN)");
  expect(script).toContain("Duel.IsCanRemoveCounter(tp,1,0,0x8,1,REASON_EFFECT)");
  expect(script).toContain("Duel.IsPlayerCanSpecialSummonMonster(tp,id+1,SET_GADGET,TYPES_TOKEN,0,0,1,RACE_MACHINE,ATTRIBUTE_EARTH,POS_FACEUP)");
  expect(script).toContain("Duel.RemoveCounter(tp,1,0,0x8,1,REASON_EFFECT)");
  expect(script).toContain("local token=Duel.CreateToken(tp,id+1)");
  expect(script).toContain("Duel.SpecialSummonStep(token,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
  expect(script).toContain("return c:IsLocation(LOCATION_EXTRA) and not c:IsType(TYPE_SYNCHRO)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
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
