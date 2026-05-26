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
const awakeningCode = "36745317";
const discardCode = "367453170";
const deckEarthCode = "367453171";
const fieldVernusylphCode = "367453172";
const fieldOffSetCode = "367453173";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAwakeningScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${awakeningCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFairy = 0x10;
const attributeEarth = 0x1;
const setVernusylph = 0x183;
const effectCannotActivate = 6;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasAwakeningScript)("Lua real script Vernusylph Awakening Forests send double stat", () => {
  it("restores helper discard/send-to-GY and field Vernusylph ATK doubling", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const source = sourceWithSharedHelpers(workspace);
    const script = source.readScript(`c${awakeningCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const handSession = createDuel({ seed: 36745317, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(handSession, { 0: { main: [awakeningCode, discardCode, deckEarthCode] }, 1: { main: [] } });
    startDuel(handSession);
    const handAwakening = requireCard(handSession, awakeningCode);
    const discard = requireCard(handSession, discardCode);
    const deckEarth = requireCard(handSession, deckEarthCode);
    moveDuelCard(handSession.state, handAwakening.uid, "hand", 0);
    moveDuelCard(handSession.state, discard.uid, "hand", 0);
    handSession.state.phase = "main1";
    handSession.state.turnPlayer = 0;
    handSession.state.waitingFor = 0;

    const handHost = createLuaScriptHost(handSession, workspace);
    expect(handHost.loadCardScript(Number(awakeningCode), source).ok).toBe(true);
    expect(handHost.registerInitialEffects()).toBe(1);

    const restoredHand = restoreDuelWithLuaScripts(serializeDuel(handSession), source, reader, {
      promptOverrides: [{ api: "SelectYesNo", player: 0, returned: false }],
    });
    expectCleanRestore(restoredHand);
    expectRestoredLegalActions(restoredHand, 0);
    const sendEarth = getLuaRestoreLegalActions(restoredHand, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handAwakening.uid && action.effectId === "lua-2"
    );
    expect(sendEarth, JSON.stringify(getLuaRestoreLegalActions(restoredHand, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredHand, sendEarth!);
    resolveRestoredChain(restoredHand);

    expect(restoredHand.session.state.cards.find((card) => card.uid === handAwakening.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonEffectId: 2,
    });
    expect(restoredHand.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonEffectId: 2,
    });
    expect(restoredHand.session.state.cards.find((card) => card.uid === deckEarth.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: handAwakening.uid,
      reasonEffectId: 2,
    });
    expect(restoredHand.session.state.effects.find((effect) => effect.sourceUid === handAwakening.uid && effect.code === effectCannotActivate)).toMatchObject({
      event: "continuous",
      targetRange: [1, 0],
      luaValueDescriptor: "cannot-activate:monster-attribute-except:1",
    });
    expect(restoredHand.session.state.eventHistory.filter((event) => ["discarded", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
    }))).toEqual([
      { current: "graveyard", eventCardUid: discard.uid, eventCode: 1018, eventName: "discarded", eventReason: duelReason.cost | duelReason.discard, eventReasonCardUid: handAwakening.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "hand" },
      { current: "graveyard", eventCardUid: discard.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost | duelReason.discard, eventReasonCardUid: handAwakening.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "hand" },
      { current: "graveyard", eventCardUid: handAwakening.uid, eventCode: 1018, eventName: "discarded", eventReason: duelReason.cost | duelReason.discard, eventReasonCardUid: handAwakening.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "hand" },
      { current: "graveyard", eventCardUid: handAwakening.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost | duelReason.discard, eventReasonCardUid: handAwakening.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "hand" },
      { current: "graveyard", eventCardUid: discard.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost | duelReason.discard, eventReasonCardUid: handAwakening.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "hand" },
      { current: "graveyard", eventCardUid: deckEarth.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: handAwakening.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "deck" },
    ]);

    const fieldSession = createDuel({ seed: 36745318, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(fieldSession, { 0: { main: [awakeningCode, fieldVernusylphCode, fieldOffSetCode] }, 1: { main: [] } });
    startDuel(fieldSession);
    const fieldAwakening = requireCard(fieldSession, awakeningCode);
    const fieldVernusylph = requireCard(fieldSession, fieldVernusylphCode);
    const offSet = requireCard(fieldSession, fieldOffSetCode);
    moveFaceUpAttack(fieldSession, fieldAwakening, 0, 0);
    moveFaceUpAttack(fieldSession, fieldVernusylph, 0, 1);
    moveFaceUpAttack(fieldSession, offSet, 0, 2);
    fieldSession.state.phase = "main1";
    fieldSession.state.turnPlayer = 0;
    fieldSession.state.waitingFor = 0;

    const fieldHost = createLuaScriptHost(fieldSession, workspace);
    expect(fieldHost.loadCardScript(Number(awakeningCode), source).ok).toBe(true);
    expect(fieldHost.registerInitialEffects()).toBe(1);

    const restoredField = restoreDuelWithLuaScripts(serializeDuel(fieldSession), source, reader);
    expectCleanRestore(restoredField);
    expectRestoredLegalActions(restoredField, 0);
    const doubleAttack = getLuaRestoreLegalActions(restoredField, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fieldAwakening.uid && action.effectId === "lua-1"
    );
    expect(doubleAttack, JSON.stringify(getLuaRestoreLegalActions(restoredField, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredField, doubleAttack!);
    resolveRestoredChain(restoredField);

    expect(currentAttack(restoredField.session.state.cards.find((card) => card.uid === fieldAwakening.uid), restoredField.session.state)).toBe(1800);
    expect(currentAttack(restoredField.session.state.cards.find((card) => card.uid === fieldVernusylph.uid), restoredField.session.state)).toBe(600);
    expect(currentAttack(restoredField.session.state.cards.find((card) => card.uid === offSet.uid), restoredField.session.state)).toBe(2000);
    expect(restoredField.session.state.effects.filter((effect) => effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: 0x400, reset: { flags: 1107169792 }, sourceUid: fieldAwakening.uid, value: 1800 },
    ]);
    expect(restoredField.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      previous: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { current: "monsterZone", eventCardUid: fieldAwakening.uid, eventCode: 1028, eventName: "becameTarget", previous: "deck", relatedEffectId: 1 },
    ]);
    expect(restoredHand.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredField.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Vernusylph of the Awakening Forests");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsSetCard,SET_VERNUSYLPH),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()*2)");
  expect(script).toContain("Vernusylph.AddSpSummonEffect(c,id,1,CATEGORY_TOGRAVE,s.tgtg,s.tgop)");
  expect(script).toContain("return c:IsAttribute(ATTRIBUTE_EARTH) and c:IsSummonableCard() and c:IsAbleToGrave()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_DECK,0,1,1,nil):GetFirst()");
  expect(script).toContain("Duel.SendtoGrave(tc,REASON_EFFECT)");
}

function sourceWithSharedHelpers(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${awakeningCode}.lua`) return `${workspace.readScript("cards_specific_functions.lua")}\n${workspace.readScript(`official/c${awakeningCode}.lua`)}`;
      return workspace.readScript(name);
    },
  };
}

function cards(): DuelCardData[] {
  return [
    { code: awakeningCode, name: "Vernusylph of the Awakening Forests", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeEarth, level: 4, attack: 900, defense: 1800, setcodes: [setVernusylph] },
    { code: discardCode, name: "Awakening Forests Discard", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: deckEarthCode, name: "Awakening Forests Deck EARTH", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeEarth, level: 4, attack: 1400, defense: 1000 },
    { code: fieldVernusylphCode, name: "Awakening Forests Field Vernusylph", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeEarth, level: 4, attack: 600, defense: 1000, setcodes: [setVernusylph] },
    { code: fieldOffSetCode, name: "Awakening Forests Off-Set", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeEarth, level: 4, attack: 2000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
