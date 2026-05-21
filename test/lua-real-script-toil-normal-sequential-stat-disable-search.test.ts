import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const toilCode = "83404468";
const fieldNormalCode = "834044680";
const effectTargetCode = "834044681";
const graveNormalCodes = ["834044682", "834044683", "834044684", "834044685", "834044686"];
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasToilScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${toilCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeNormal = 0x10;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasToilScript)("Lua real script The Toil of the Normal sequential stat disable search", () => {
  it("restores five-Normal sequence into field ATK/protection, effect negate, Deck shuffle, and search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${toilCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 83404468, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [toilCode, toilCode, fieldNormalCode, effectTargetCode, ...graveNormalCodes] }, 1: { main: [] } });
    startDuel(session);

    const toilCopies = session.state.cards.filter((card) => card.code === toilCode);
    expect(toilCopies).toHaveLength(2);
    const activatedToil = toilCopies[0]!;
    const searchedToil = toilCopies[1]!;
    const fieldNormal = requireCard(session, fieldNormalCode);
    const effectTarget = requireCard(session, effectTargetCode);
    moveDuelCard(session.state, activatedToil.uid, "hand", 0);
    moveFaceUpAttack(session, fieldNormal, 0);
    moveFaceUpAttack(session, effectTarget, 1);
    for (const code of graveNormalCodes) {
      moveDuelCard(session.state, requireCard(session, code).uid, "graveyard", 0).faceUp = true;
    }
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(toilCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === activatedToil.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    passRestoredChain(restoredOpen);

    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === fieldNormal.uid)!, restoredOpen.session.state)).toBe(1800);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === effectTarget.uid)).toMatchObject({
      location: "deck",
      reason: duelReason.effect,
      reasonCardUid: activatedToil.uid,
      reasonEffectId: 1,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === searchedToil.uid)).toMatchObject({
      location: "hand",
      reason: duelReason.effect,
      reasonCardUid: activatedToil.uid,
      reasonEffectId: 1,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === activatedToil.uid && (effect.code === 100 || effect.code === 41)).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      {
        code: 100,
        controller: 0,
        range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"],
        reset: { flags: 1073742336 },
        sourceUid: activatedToil.uid,
        targetRange: [4, 0],
        value: 800,
      },
      {
        code: 41,
        controller: 0,
        range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"],
        reset: { flags: 1073742336 },
        sourceUid: activatedToil.uid,
        targetRange: [4, 0],
        value: 1,
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["breakEffect", "sentToDeck", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: undefined, eventName: "breakEffect", eventReason: duelReason.effect, eventReasonCardUid: activatedToil.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: undefined, eventName: "breakEffect", eventReason: duelReason.effect, eventReasonCardUid: activatedToil.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: undefined, eventName: "breakEffect", eventReason: duelReason.effect, eventReasonCardUid: activatedToil.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: effectTarget.uid, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: activatedToil.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: undefined, eventName: "breakEffect", eventReason: duelReason.effect, eventReasonCardUid: activatedToil.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: searchedToil.uid, eventName: "sentToHandConfirmed", eventReason: duelReason.effect, eventReasonCardUid: activatedToil.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
    ]);

    const firstDestroy = destroyDuelCard(restoredOpen.session.state, fieldNormal.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(firstDestroy).toMatchObject({ location: "monsterZone", uid: fieldNormal.uid });
    const secondDestroy = destroyDuelCard(restoredOpen.session.state, fieldNormal.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(secondDestroy).toMatchObject({ location: "monsterZone", uid: fieldNormal.uid });
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DISABLE+CATEGORY_TODECK+CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsType,tp,LOCATION_GRAVE,0,nil,TYPE_NORMAL):GetClassCount(Card.GetCode)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_ATKCHANGE,nil,0,tp,800)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DISABLE,nil,1,tp,LOCATION_MZONE)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TODECK,nil,1,tp,LOCATION_MZONE)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("aux.RegisterClientHint(c,0,tp,1,0,aux.Stringid(id,1))");
  expect(script).toContain("sc:NegateEffects(c,RESET_PHASE|PHASE_END)");
  expect(script).toContain("Duel.AdjustInstantly(sc)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function cards(): DuelCardData[] {
  return [
    { code: toilCode, name: "The Toil of the Normal", kind: "spell", typeFlags: typeSpell },
    { code: fieldNormalCode, name: "Toil Field Normal", kind: "monster", typeFlags: typeMonster | typeNormal, level: 4, attack: 1000, defense: 1000 },
    { code: effectTargetCode, name: "Toil Effect Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
    ...graveNormalCodes.map((code, index) => ({
      code,
      name: `Toil Grave Normal ${index + 1}`,
      kind: "monster" as const,
      typeFlags: typeMonster | typeNormal,
      level: 4,
      attack: 900 + index * 100,
      defense: 1000,
    })),
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
