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
const typeTrap = 0x4;
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Crimson Ninja flip confirm trap destroy", () => {
  it("restores Crimson Ninja's flip target, facedown Trap confirmation, and conditional destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const crimsonNinjaCode = "14618326";
    const trapTargetCode = "14618327";
    const responderCode = "14618328";
    const script = workspace.readScript(`c${crimsonNinjaCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)");
    expect(script).toContain("return c:IsTrap() or (c:IsFacedown() and c:IsLocation(LOCATION_SZONE) and c:GetSequence()~=5)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
    expect(script).toContain("if #g>0 and g:GetFirst():IsFaceup() then");
    expect(script).toContain("Duel.ConfirmCards(tp,tc)");
    expect(script).toContain("if tc:IsTrap() then Duel.Destroy(tc,REASON_EFFECT) end");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === crimsonNinjaCode),
      { code: trapTargetCode, name: "Crimson Ninja Set Trap Target", kind: "trap", typeFlags: typeTrap },
      { code: responderCode, name: "Crimson Ninja Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 14618326, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [crimsonNinjaCode] }, 1: { main: [trapTargetCode, responderCode] } });
    startDuel(session);

    const crimsonNinja = requireCard(session, crimsonNinjaCode);
    const trapTarget = requireCard(session, trapTargetCode);
    const responder = requireCard(session, responderCode);
    const movedNinja = moveDuelCard(session.state, crimsonNinja.uid, "monsterZone", 0);
    movedNinja.position = "faceDownDefense";
    movedNinja.faceUp = false;
    const movedTrap = moveDuelCard(session.state, trapTarget.uid, "spellTrapZone", 1);
    movedTrap.position = "faceDown";
    movedTrap.faceUp = false;
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
    expect(host.loadCardScript(Number(crimsonNinjaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenWindow);
    expectRestoredLegalActions(restoredOpenWindow, 0);
    const flip = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((action) => action.type === "flipSummon" && action.uid === crimsonNinja.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenWindow, flip!);
    expect(restoredOpenWindow.session.state.pendingTriggers).toEqual([
      {
        player: 0,
        id: "trigger-3-1",
        effectId: "lua-1",
        sourceUid: crimsonNinja.uid,
        triggerBucket: "turnMandatory",
        eventName: "flipSummoned",
        eventCode: 1101,
        eventCardUid: crimsonNinja.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === crimsonNinja.uid,
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual([]);
    expect(restoredTriggerWindow.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        sourceUid: crimsonNinja.uid,
        player: 0,
        effectId: "lua-1",
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "flipSummoned",
        eventCode: 1101,
        eventCardUid: crimsonNinja.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        targetFieldIds: [5],
        targetUids: [trapTarget.uid],
      },
    ]);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expectCleanRestore(restoredChainWindow);
    expectRestoredLegalActions(restoredChainWindow, 1);
    expect(restoredChainWindow.session.state.chain[0]?.targetUids).toEqual([trapTarget.uid]);
    expect(restoredChainWindow.session.state.chain[0]?.operationInfos).toBeUndefined();
    const responderAction = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "activateEffect" && action.uid === responder.uid);
    expect(responderAction).toBeDefined();
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass?.windowKind).toBe("chainResponse");
    applyLuaRestoreAndAssert(restoredChainWindow, pass!);

    expect(restoredChainWindow.session.state.chain).toEqual([]);
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === crimsonNinja.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
    });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === trapTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChainWindow.host.messages).toEqual([`confirmed 0: ${trapTargetCode}`]);
    expect(restoredChainWindow.host.messages).not.toContain("crimson ninja responder resolved");
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => ["flipSummoned", "confirmed", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "flipSummoned",
        eventCode: 1101,
        eventCardUid: crimsonNinja.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventPlayer: 0,
        eventUids: [trapTarget.uid],
        eventValue: 1,
        eventCardUid: trapTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: false,
          location: "spellTrapZone",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: trapTarget.uid,
        eventPreviousState: {
          location: "spellTrapZone",
          controller: 1,
          sequence: 0,
          position: "faceDown",
          faceUp: false,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 1,
          sequence: 0,
          position: "faceDown",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: crimsonNinja.uid,
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
      e:SetOperation(function(e,tp) Debug.Message("crimson ninja responder resolved") end)
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
