import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { statusProcComplete } from "#duel/procedure-status.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const crystalHeartCode = "61668670";
const earthLinkCode = "616686700";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCrystalHeartScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${crystalHeartCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const attributeEarth = 0x1;
const crystalCounter = 0x20c;
const markerLeft = 0x8;
const markerRight = 0x20;
const effectUpdateAttack = 100;
const effectExtraAttack = 194;
const effectPierce = 203;

describe.skipIf(!hasUpstreamScripts || !hasCrystalHeartScript)("Lua real script G Golem Crystal Heart linked counter stat", () => {
  it("restores linked-zone grave summon, custom counter, and co-linked EARTH grants", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectCrystalHeartScriptShape(workspace.readScript(`official/c${crystalHeartCode}.lua`));
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredOpen({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const crystalHeart = requireCard(restoredOpen.session, crystalHeartCode);
    const earthLink = requireCard(restoredOpen.session, earthLinkCode);
    expect(restoredOpen.session.state.effects.filter((effect) =>
      effect.sourceUid === crystalHeart.uid && (effect.category === 8389120 || [effectUpdateAttack, effectExtraAttack, effectPierce].includes(effect.code ?? -1))
    ).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { category: 8389120, code: undefined, event: "ignition", property: 16, range: ["monsterZone"], targetRange: undefined, value: undefined },
      { category: undefined, code: effectUpdateAttack, event: "continuous", property: undefined, range: ["monsterZone"], targetRange: [4, 4], value: undefined },
      { category: undefined, code: effectExtraAttack, event: "continuous", property: undefined, range: ["monsterZone"], targetRange: [4, 4], value: 1 },
      { category: undefined, code: effectPierce, event: "continuous", property: undefined, range: ["monsterZone"], targetRange: [4, 4], value: undefined },
    ]);

    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === crystalHeart.uid,
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === earthLink.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 2,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: crystalHeart.uid,
      reasonEffectId: 3,
    });
    expect(getDuelCardCounter(requireCard(restoredOpen.session, crystalHeartCode), crystalCounter)).toBe(1);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === earthLink.uid), restoredOpen.session.state)).toBe(2400);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === crystalHeart.uid), restoredOpen.session.state)).toBe(0);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "specialSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
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
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: earthLink.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3, previous: "extraDeck", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: earthLink.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: crystalHeart.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previous: "graveyard", current: "monsterZone" },
      { eventName: "counterAdded", eventCode: 65536, eventCardUid: crystalHeart.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: crystalHeart.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
    ]);
  });
});

function createRestoredOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 61668670, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [crystalHeartCode, earthLinkCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpLink(session, requireCard(session, crystalHeartCode), 0, 1);
  const earthLink = moveDuelCard(session.state, requireCard(session, earthLinkCode).uid, "graveyard", 0);
  earthLink.faceUp = true;
  earthLink.customStatusMask = statusProcComplete;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(crystalHeartCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectCrystalHeartScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("G Golem Crystal Heart");
  expect(script).toContain("c:EnableCounterPermit(0x20c)");
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_CYBERSE),2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("local zone=c:GetFreeLinkedZone()&ZONES_MMZ");
  expect(script).toContain("Duel.IsExistingTarget(s.spfilter,tp,LOCATION_GRAVE,0,1,nil,e,tp,zone)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp,zone)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,tp,LOCATION_GRAVE)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP,zone)>0");
  expect(script).toContain("c:AddCounter(0x20c,1)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e3:SetCode(EFFECT_EXTRA_ATTACK)");
  expect(script).toContain("e4:SetCode(EFFECT_PIERCE)");
  expect(script).toContain("return e:GetHandler():GetMutualLinkedGroup():IsContains(c) and c:IsAttribute(ATTRIBUTE_EARTH)");
  expect(script).toContain("return e:GetHandler():GetCounter(0x20c)*600");
}

function cards(): DuelCardData[] {
  return [
    { code: crystalHeartCode, name: "G Golem Crystal Heart", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeEarth, level: 2, attack: 0, defense: 0, linkMarkers: markerRight, linkMaterialMin: 2 },
    { code: earthLinkCode, name: "Crystal Heart EARTH Linked Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeEarth, level: 1, attack: 1800, defense: 0, linkMarkers: markerLeft, linkMaterialMin: 1 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpLink(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.summonType = "link";
  moved.summonTypeCode = 0x4c000000;
  moved.customStatusMask = statusProcComplete;
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
