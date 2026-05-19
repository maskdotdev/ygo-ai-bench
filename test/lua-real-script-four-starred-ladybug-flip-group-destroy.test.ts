import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script 4-Starred Ladybug of Doom Flip group destroy", () => {
  it("restores its non-targeted Flip group destruction of opponent face-up Level 4 monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ladybugCode = "83994646";
    const firstTargetCode = "839946460";
    const secondTargetCode = "839946461";
    const facedownLevel4Code = "839946462";
    const level3DecoyCode = "839946463";
    const ownLevel4Code = "839946464";
    const responderCode = "839946465";
    const script = workspace.readScript(`c${ladybugCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)");
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY)");
    expect(script).not.toContain("EFFECT_FLAG_CARD_TARGET");
    expect(script).not.toContain("Duel.SelectTarget");
    expect(script).toContain("return c:IsFaceup() and c:GetLevel()==4");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,0,LOCATION_MZONE,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)");
    expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ladybugCode),
      { code: firstTargetCode, name: "Ladybug First Level 4 Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200 },
      { code: secondTargetCode, name: "Ladybug Second Level 4 Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1100 },
      { code: facedownLevel4Code, name: "Ladybug Face-down Level 4 Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1700, defense: 1300 },
      { code: level3DecoyCode, name: "Ladybug Level 3 Decoy", kind: "monster", typeFlags: typeMonster, level: 3, attack: 1400, defense: 1000 },
      { code: ownLevel4Code, name: "Ladybug Own Level 4 Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1300, defense: 900 },
      { code: responderCode, name: "Ladybug Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 83994646, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [ladybugCode, ownLevel4Code] },
      1: { main: [firstTargetCode, secondTargetCode, facedownLevel4Code, level3DecoyCode, responderCode] },
    });
    startDuel(session);

    const ladybug = requireCard(session, ladybugCode);
    const firstTarget = requireCard(session, firstTargetCode);
    const secondTarget = requireCard(session, secondTargetCode);
    const facedownLevel4 = requireCard(session, facedownLevel4Code);
    const level3Decoy = requireCard(session, level3DecoyCode);
    const ownLevel4 = requireCard(session, ownLevel4Code);
    const responder = requireCard(session, responderCode);
    const movedLadybug = moveDuelCard(session.state, ladybug.uid, "monsterZone", 0);
    movedLadybug.position = "faceDownDefense";
    movedLadybug.faceUp = false;
    const movedOwnLevel4 = moveDuelCard(session.state, ownLevel4.uid, "monsterZone", 0);
    movedOwnLevel4.sequence = 1;
    movedOwnLevel4.position = "faceUpAttack";
    movedOwnLevel4.faceUp = true;
    const movedFirstTarget = moveDuelCard(session.state, firstTarget.uid, "monsterZone", 1);
    movedFirstTarget.sequence = 0;
    movedFirstTarget.position = "faceUpAttack";
    movedFirstTarget.faceUp = true;
    const movedSecondTarget = moveDuelCard(session.state, secondTarget.uid, "monsterZone", 1);
    movedSecondTarget.sequence = 1;
    movedSecondTarget.position = "faceUpAttack";
    movedSecondTarget.faceUp = true;
    const movedFacedown = moveDuelCard(session.state, facedownLevel4.uid, "monsterZone", 1);
    movedFacedown.sequence = 2;
    movedFacedown.position = "faceDownDefense";
    movedFacedown.faceUp = false;
    const movedLevel3 = moveDuelCard(session.state, level3Decoy.uid, "monsterZone", 1);
    movedLevel3.sequence = 3;
    movedLevel3.position = "faceUpAttack";
    movedLevel3.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ladybugCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenWindow);
    expectRestoredLegalActions(restoredOpenWindow, 0);
    const flip = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((action) => action.type === "flipSummon" && action.uid === ladybug.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenWindow, flip!);
    expect(restoredOpenWindow.session.state.pendingTriggers).toEqual([
      {
        player: 0,
        id: "trigger-3-1",
        effectId: "lua-1",
        sourceUid: ladybug.uid,
        triggerBucket: "turnMandatory",
        eventName: "flipSummoned",
        eventCode: 1101,
        eventCardUid: ladybug.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { location: "deck", controller: 0, sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { location: "monsterZone", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
      },
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === ladybug.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, trigger!);
    const destroyedUids = [firstTarget.uid, secondTarget.uid];
    expect(restoredTriggerWindow.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        sourceUid: ladybug.uid,
        player: 0,
        effectId: "lua-1",
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "flipSummoned",
        eventCode: 1101,
        eventCardUid: ladybug.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { location: "deck", controller: 0, sequence: 1, position: "faceDown", faceUp: false },
        eventCurrentState: { location: "monsterZone", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
        operationInfos: [{ category: 0x1, targetUids: destroyedUids, count: 2, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredChainWindow);
    expectRestoredLegalActions(restoredChainWindow, 1);
    expect(getLuaRestoreLegalActions(restoredChainWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass?.windowKind).toBe("chainResponse");
    applyLuaRestoreAndAssert(restoredChainWindow, pass!);

    expect(restoredChainWindow.session.state.chain).toEqual([]);
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === ladybug.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === firstTarget.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === secondTarget.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === facedownLevel4.uid)).toMatchObject({ location: "monsterZone", controller: 1, faceUp: false });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === level3Decoy.uid)).toMatchObject({ location: "monsterZone", controller: 1, faceUp: true });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === ownLevel4.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChainWindow.host.messages).not.toContain("ladybug responder resolved");
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: firstTarget.uid,
        eventPreviousState: { location: "monsterZone", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: ladybug.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: secondTarget.uid,
        eventPreviousState: { location: "monsterZone", controller: 1, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 1, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: ladybug.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: firstTarget.uid,
        eventUids: destroyedUids,
        eventPreviousState: { location: "monsterZone", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: ladybug.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("ladybug responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
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
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
