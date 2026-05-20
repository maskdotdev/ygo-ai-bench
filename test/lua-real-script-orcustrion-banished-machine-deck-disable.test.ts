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
const orcustrionCode = "3134857";
const hasOrcustrionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${orcustrionCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceMachine = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasOrcustrionScript)("Lua real script Orcustrion banished Machine deck disable", () => {
  it("restores banished Machine targets to Deck, operated shuffle, and linked opponent stat disable", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const machineCodes = ["313485701", "313485702", "313485703"];
    const linkedTargetCode = "313485704";
    const linkedPartnerCode = "313485705";
    const script = workspace.readScript(`official/c${orcustrionCode}.lua`);
    expect(script).toContain("e3:SetCategory(CATEGORY_TODECK+CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE+CATEGORY_DISABLE)");
    expect(script).toContain("e3:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_MACHINE) and c:IsAbleToDeck()");
    expect(script).toContain("Duel.SelectTarget(tp,s.tdfilter,tp,LOCATION_REMOVED,0,3,3,nil)");
    expect(script).toContain("Duel.SendtoDeck(tg,nil,SEQ_DECKTOP,REASON_EFFECT)");
    expect(script).toContain("local og=Duel.GetOperatedGroup()");
    expect(script).toContain("if og:IsExists(Card.IsLocation,1,nil,LOCATION_DECK) then Duel.ShuffleDeck(tp) end");
    expect(script).toContain("local g=Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsLinked),tp,0,LOCATION_MZONE,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e4:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e5:SetCode(EFFECT_SET_DEFENSE_FINAL)");

    const cards: DuelCardData[] = [
      { code: orcustrionCode, name: "Orcustrion", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, level: 4, attack: 3000, defense: 0, linkMarkers: 0x1 },
      ...machineCodes.map((code, index) => ({
        code,
        name: `Orcustrion Banished Machine ${index + 1}`,
        kind: "monster" as const,
        typeFlags: typeMonster | typeEffect,
        race: raceMachine,
        level: 4,
        attack: 1000 + index,
        defense: 1000,
      })),
      { code: linkedTargetCode, name: "Orcustrion Linked Target", kind: "monster", typeFlags: typeMonster | typeEffect | typeLink, level: 4, attack: 2400, defense: 1800, linkMarkers: 0x20 },
      { code: linkedPartnerCode, name: "Orcustrion Linked Partner", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1400, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3134857, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: machineCodes, extra: [orcustrionCode] }, 1: { main: [linkedTargetCode, linkedPartnerCode] } });
    startDuel(session);

    const orcustrion = requireCard(session, orcustrionCode);
    const machines = machineCodes.map((code) => requireCard(session, code));
    const linkedTarget = requireCard(session, linkedTargetCode);
    const linkedPartner = requireCard(session, linkedPartnerCode);
    moveDuelCard(session.state, orcustrion.uid, "monsterZone", 0);
    orcustrion.faceUp = true;
    orcustrion.position = "faceUpAttack";
    for (const machine of machines) moveDuelCard(session.state, machine.uid, "banished", 0).faceUp = true;
    moveDuelCard(session.state, linkedTarget.uid, "monsterZone", 1);
    linkedTarget.faceUp = true;
    linkedTarget.position = "faceUpAttack";
    linkedTarget.sequence = 1;
    moveDuelCard(session.state, linkedPartner.uid, "monsterZone", 1);
    linkedPartner.faceUp = true;
    linkedPartner.position = "faceUpAttack";
    linkedPartner.sequence = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(orcustrionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === orcustrion.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, action!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    for (const machine of machines) {
      expect(restoredOpen.session.state.cards.find((card) => card.uid === machine.uid)).toMatchObject({ location: "deck", controller: 0 });
    }
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === linkedTarget.uid), restoredOpen.session.state)).toBe(0);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === linkedTarget.uid), restoredOpen.session.state)).toBe(0);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === linkedPartner.uid), restoredOpen.session.state)).toBe(0);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === linkedPartner.uid), restoredOpen.session.state)).toBe(0);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: machines[0]!.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
        relatedEffectId: 4,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: machines[1]!.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 1 },
        relatedEffectId: 4,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: machines[2]!.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 2 },
        relatedEffectId: 4,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToDeck")).toEqual([
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: machines[0]!.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: orcustrion.uid,
        eventReasonEffectId: 4,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: machines[1]!.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 1 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: orcustrion.uid,
        eventReasonEffectId: 4,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: machines[2]!.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 2 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: orcustrion.uid,
        eventReasonEffectId: 4,
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: machines[0]!.uid,
        eventUids: machines.map((card) => card.uid),
        eventPreviousState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "deck", position: "faceDown", sequence: 2 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: orcustrion.uid,
        eventReasonEffectId: 4,
      },
    ]);
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
