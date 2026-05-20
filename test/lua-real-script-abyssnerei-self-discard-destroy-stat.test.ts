import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const abyssnereiCode = "71133680";
const hasAbyssnereiScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${abyssnereiCode}.lua`));
const targetCode = "711336800";
const destroyCode = "711336801";
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeWater = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasAbyssnereiScript)("Lua real script Abyssnerei self-discard destroy stat", () => {
  it("restores hand self-discard cost into WATER destruction and base-stat boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${abyssnereiCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE+CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetRange(LOCATION_HAND)");
    expect(script).toContain("e1:SetCost(Cost.SelfDiscard)");
    expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.desfilter,tp,LOCATION_MZONE|LOCATION_HAND,0,1,1,tc)");
    expect(script).toContain("if dc and Duel.Destroy(dc,REASON_EFFECT)~=0 then");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(dc:GetBaseAttack())");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e2:SetValue(dc:GetBaseDefense())");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === abyssnereiCode),
      { code: targetCode, name: "Abyssnerei WATER Target", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
      { code: destroyCode, name: "Abyssnerei WATER Destroyed", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWater, level: 4, attack: 1600, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 71133680, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [abyssnereiCode, targetCode, destroyCode] }, 1: { main: [] } });
    startDuel(session);

    const abyssnerei = requireCard(session, abyssnereiCode);
    const target = requireCard(session, targetCode);
    const destroyed = requireCard(session, destroyCode);
    moveDuelCard(session.state, abyssnerei.uid, "hand", 0);
    moveDuelCard(session.state, target.uid, "monsterZone", 0).position = "faceUpAttack";
    target.faceUp = true;
    moveDuelCard(session.state, destroyed.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(abyssnereiCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === abyssnerei.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, action!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === abyssnerei.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: abyssnerei.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === destroyed.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: abyssnerei.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(2600);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(2200);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === target.uid && (effect.code === 100 || effect.code === 104)).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, controller: 0, event: "continuous", range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: target.uid, value: 1600 },
      { code: 104, controller: 0, event: "continuous", range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: target.uid, value: 1200 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["sentToGraveyard", "destroyed", "becameTarget"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: abyssnerei.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: abyssnerei.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyed.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: abyssnerei.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: destroyed.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: abyssnerei.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
    ]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
  });
});

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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
