import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const mysticBoxCode = "25774450";
const ownTargetCode = "257744500";
const destroyTargetCode = "257744501";
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryDestroy = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mystic Box destroy control operation info", () => {
  it("restores separate destroy/control targets through GetOperationInfo into BreakEffect control transfer", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${mysticBoxCode}.lua`);
    expect(script).toContain("--Mystic Box");
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return Duel.GetMZoneCount(tp,c,tp,LOCATION_REASON_CONTROL)>0");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil,1-tp)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToChangeControler,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g1,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,g2,1,0,0)");
    expect(script).toContain("local ex1,dg=Duel.GetOperationInfo(0,CATEGORY_DESTROY)");
    expect(script).toContain("local ex2,cg=Duel.GetOperationInfo(0,CATEGORY_CONTROL)");
    expect(script).toContain("Duel.Destroy(dc,REASON_EFFECT)>0");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.GetControl(cc,1-tp)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mysticBoxCode),
      { code: ownTargetCode, name: "Mystic Box Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1700, defense: 1000 },
      { code: destroyTargetCode, name: "Mystic Box Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1900, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 25774450, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mysticBoxCode, ownTargetCode] }, 1: { main: [destroyTargetCode] } });
    startDuel(session);

    const mysticBox = requireCard(session, mysticBoxCode);
    const ownTarget = requireCard(session, ownTargetCode);
    const destroyTarget = requireCard(session, destroyTargetCode);
    moveDuelCard(session.state, mysticBox.uid, "spellTrapZone", 0);
    mysticBox.faceUp = false;
    mysticBox.position = "faceDown";
    moveFaceUpAttack(session, ownTarget, 0);
    moveFaceUpAttack(session, destroyTarget, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mysticBoxCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(
      restoredOpen.session.state.effects.map((effect) => ({
        category: effect.category,
        code: effect.code,
        event: effect.event,
        property: effect.property,
        range: effect.range,
        sourceUid: effect.sourceUid,
      })),
    ).toEqual([{ category: categoryDestroy, code: 1002, event: "ignition", property: 16, range: ["hand", "spellTrapZone"], sourceUid: mysticBox.uid }]);

    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === mysticBox.uid && candidate.effectId === "lua-1-1002");
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, action!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === mysticBox.uid)).toMatchObject({
      controller: 0,
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredResolved.session.state.cards.find((card) => card.uid === destroyTarget.uid)).toMatchObject({
      controller: 1,
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: mysticBox.uid,
      reasonEffectId: 1,
    });
    expect(restoredResolved.session.state.cards.find((card) => card.uid === ownTarget.uid)).toMatchObject({
      controller: 1,
      previousController: 0,
      location: "monsterZone",
    });
    expect(restoredResolved.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "controlChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: destroyTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: ownTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyTarget.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: mysticBox.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: ownTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: mysticBox.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
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
