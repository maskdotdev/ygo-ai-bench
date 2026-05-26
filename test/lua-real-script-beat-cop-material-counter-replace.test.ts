import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const beatCopCode = "99011763";
const darkMaterialACode = "990117630";
const darkMaterialBCode = "990117631";
const releaseCode = "990117632";
const protectedCode = "990117633";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBeatCopScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${beatCopCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const counterPatrol = 0x1049;
const categoryCounter = 0x800000;
const effectMaterialCheck = 251;
const effectDestroyReplace = 50;
const linkSummonReason = duelReason.link | duelReason.summon | duelReason.specialSummon;

describe.skipIf(!hasUpstreamScripts || !hasBeatCopScript)("Lua real script Beat Cop material counter replace", () => {
  it("restores DARK distinct-code material check into counter ignition and destroy replacement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectBeatCopScriptShape(workspace.readScript(`official/c${beatCopCode}.lua`));
    const reader = createCardReader(cards());
    const source = fixtureSource(workspace);
    const restoredLink = createRestoredPreLinkState(reader, source);
    expectCleanRestore(restoredLink);
    expectRestoredLegalActions(restoredLink, 0);

    const beatCop = requireCard(restoredLink.session, beatCopCode);
    const materialA = requireCard(restoredLink.session, darkMaterialACode);
    const materialB = requireCard(restoredLink.session, darkMaterialBCode);
    const protectedTarget = requireCard(restoredLink.session, protectedCode);
    expect(restoredLink.session.state.effects.filter((effect) => effect.sourceUid === beatCop.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      id: effect.id,
      range: effect.range,
      valuePredicate: typeof effect.valuePredicate,
    }))).toEqual([
      { code: 31, event: "continuous", id: "lua-2-31", range: ["extraDeck"], valuePredicate: "undefined" },
      { code: effectMaterialCheck, event: "continuous", id: "lua-3-251", range: ["extraDeck"], valuePredicate: "function" },
    ]);

    const linkSummon = getLuaRestoreLegalActions(restoredLink, 0).find((action) =>
      action.type === "linkSummon" && action.uid === beatCop.uid && sameMembers(action.materialUids, [materialA.uid, materialB.uid])
    );
    expect(linkSummon, JSON.stringify(getLuaRestoreLegalActions(restoredLink, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLink, linkSummon!);

    expect(findCard(restoredLink.session, beatCop.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "link",
      summonMaterialUids: [materialA.uid, materialB.uid],
      reason: linkSummonReason,
      reasonPlayer: 0,
    });
    expect(restoredLink.session.state.effects.filter((effect) => effect.sourceUid === beatCop.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", id: "lua-2-31", property: 263168, range: ["extraDeck"] },
      { category: undefined, code: effectMaterialCheck, countLimit: undefined, event: "continuous", id: "lua-3-251", property: undefined, range: ["extraDeck"] },
      { category: categoryCounter, code: undefined, countLimit: 1, event: "ignition", id: "lua-4", property: 16, range: ["monsterZone"] },
    ]);
    expect(restoredLink.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: beatCop.uid, eventReason: linkSummonReason, eventReasonPlayer: 0, previous: "extraDeck", current: "monsterZone" },
    ]);
    findCard(restoredLink.session, beatCop.uid).sequence = 4;

    const ignition = getLuaRestoreLegalActions(restoredLink, 0).find((action) =>
      action.type === "activateEffect" && action.uid === beatCop.uid && action.effectId === "lua-4"
    );
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredLink, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLink, ignition!);
    resolveRestoredChain(restoredLink);

    const releasedEvent = restoredLink.session.state.eventHistory.find((event) => event.eventName === "released");
    expect(releasedEvent).toMatchObject({
      eventReason: duelReason.release | duelReason.cost,
      eventReasonPlayer: 0,
      eventReasonCardUid: beatCop.uid,
      eventReasonEffectId: 4,
    });
    const releasedUid = releasedEvent?.eventCardUid;
    expect(releasedUid).toBeDefined();
    if (releasedUid === undefined) throw new Error("Expected Beat Cop release-cost event to have a card uid");
    const releasedCard = findCard(restoredLink.session, releasedUid);
    expect(releasedCard).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: beatCop.uid,
      reasonEffectId: 4,
    });
    const counteredCards = restoredLink.session.state.cards.filter((card) => getDuelCardCounter(card, counterPatrol) === 1);
    expect(counteredCards.map((card) => card.uid)).toEqual([protectedTarget.uid]);
    expect(restoredLink.session.state.effects.filter((effect) => effect.sourceUid === protectedTarget.uid && effect.code === effectDestroyReplace).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectDestroyReplace, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], reset: { flags: 33427456 }, sourceUid: protectedTarget.uid },
    ]);
    expect(restoredLink.session.state.eventHistory.filter((event) => ["released", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "released", eventCardUid: releasedUid, eventReason: duelReason.release | duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: beatCop.uid, eventReasonEffectId: 4 },
      { eventName: "counterAdded", eventCardUid: protectedTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: beatCop.uid, eventReasonEffectId: 4 },
    ]);

    const eventStart = restoredLink.session.state.eventHistory.length;
    destroyDuelCard(restoredLink.session.state, protectedTarget.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(findCard(restoredLink.session, protectedTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(getDuelCardCounter(findCard(restoredLink.session, protectedTarget.uid), counterPatrol)).toBe(0);
    expect(restoredLink.session.state.eventHistory.slice(eventStart).filter((event) => ["counterRemoved", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "counterRemoved", eventCardUid: protectedTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: protectedTarget.uid, eventReasonEffectId: 5 },
    ]);
  });
});

function createRestoredPreLinkState(
  reader: ReturnType<typeof createCardReader>,
  source: ScriptSource,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 99011763, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [darkMaterialACode, darkMaterialBCode, releaseCode, protectedCode], extra: [beatCopCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, darkMaterialACode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, darkMaterialBCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, releaseCode), 0, 2);
  moveFaceUpAttack(session, requireCard(session, protectedCode), 0, 3);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, source);
  for (const code of [beatCopCode, protectedCode]) {
    expect(host.loadCardScript(Number(code), source).ok).toBe(true);
  }
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

type ScriptSource = { readScript(name: string): string | undefined };

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ScriptSource {
  return {
    readScript(name: string) {
      if (name === `c${protectedCode}.lua`) return counterPermitScript();
      return workspace.readScript(name);
    },
  };
}

function counterPermitScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      c:EnableCounterPermit(0x1049,LOCATION_ONFIELD)
    end
  `;
}

function expectBeatCopScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Beat Cop from the Underworld");
  expect(script).toContain("Link.AddProcedure(c,nil,2,2)");
  expect(script).toContain("e1:SetCode(EFFECT_MATERIAL_CHECK)");
  expect(script).toContain("if #g==2 and g:GetClassCount(Card.GetCode)==#g and not g:IsExists(aux.NOT(Card.IsAttribute),1,nil,ATTRIBUTE_DARK) then");
  expect(script).toContain("s.counter_place_list={0x1049}");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetCountLimit(1,id)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,nil,nil)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,nil,nil)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("tc:AddCounter(0x1049,1)");
  expect(script).toContain("e1:SetCode(EFFECT_DESTROY_REPLACE)");
  expect(script).toContain("return not e:GetHandler():IsReason(REASON_REPLACE+REASON_RULE) and e:GetHandler():GetCounter(0x1049)>0");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,0x1049,1,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: beatCopCode, name: "Beat Cop from the Underworld", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceFiend, attribute: attributeDark, level: 2, attack: 1000, defense: 0, linkMarkers: 0x12, linkMaterialMin: 2, linkMaterialMax: 2 },
    { code: darkMaterialACode, name: "Beat Cop DARK Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: darkMaterialBCode, name: "Beat Cop DARK Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1100, defense: 1000 },
    { code: releaseCode, name: "Beat Cop Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: protectedCode, name: "Beat Cop Protected Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1300, defense: 1000 },
  ];
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function requireAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, type: DuelAction["type"]): DuelAction {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type && (candidate as { uid?: string }).uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  return action!;
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
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function sameMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((uid) => actual.includes(uid));
}
