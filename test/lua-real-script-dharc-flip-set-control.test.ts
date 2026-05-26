import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dharc flip set-control", () => {
  it("restores Dharc's targeted flip control effect and persistent EFFECT_SET_CONTROL handoff", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dharcCode = "19327348";
    const darkTargetCode = "19327349";
    const responderCode = "19327350";
    const script = workspace.readScript(`official/c${dharcCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return c:IsFaceup() and c:IsAttribute(ATTRIBUTE_DARK) and c:IsControlerCanBeChanged()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,g,#g,0,0)");
    expect(script).toContain("c:SetCardTarget(tc)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_CONTROL)");
    expect(script).toContain("e1:SetCondition(s.ctcon)");
    expect(script).toContain("return c:IsHasCardTarget(h)");
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dharcCode),
      { code: darkTargetCode, name: "Dharc DARK Control Target", kind: "monster", typeFlags: 0x1, attribute: 0x20, level: 4, attack: 1600, defense: 1200 },
      { code: responderCode, name: "Dharc Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 19327, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dharcCode] }, 1: { main: [darkTargetCode, responderCode] } });
    startDuel(session);

    const dharc = requireCard(session, dharcCode);
    const darkTarget = requireCard(session, darkTargetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, dharc.uid, "monsterZone", 0);
    dharc.position = "faceDownDefense";
    dharc.faceUp = false;
    moveDuelCard(session.state, darkTarget.uid, "monsterZone", 1);
    darkTarget.position = "faceUpAttack";
    darkTarget.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dharcCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const flip = getLegalActions(session, 0).find((action) => action.type === "flipSummon" && action.uid === dharc.uid);
    expect(flip).toBeDefined();
    applyAndAssert(session, flip!);
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        player: 0,
        effectId: "lua-1",
        sourceUid: dharc.uid,
        triggerBucket: "turnMandatory",
        eventName: "flipSummoned",
        eventCode: 1001,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPlayer: 0,
        eventCardUid: dharc.uid,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
        eventCurrentState: { controller: 0, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
      },
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const triggerAction = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === dharc.uid);
    expect(triggerAction, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restoredTriggerWindow, triggerAction!);
    expect(activated.ok, activated.error).toBe(true);
    expect(restoredTriggerWindow.session.state.chain).toHaveLength(1);
    expect(restoredTriggerWindow.session.state.chain[0]).toEqual({
      activationLocation: "monsterZone",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1",
      eventCardUid: dharc.uid,
      eventCode: 1001,
      eventCurrentState: { controller: 0, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
      eventName: "flipSummoned",
      eventPlayer: 0,
      eventPreviousState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: false },
      eventReason: 0,
      eventReasonPlayer: 0,
      eventTriggerTiming: "when",
      id: "chain-3",
      operationInfos: [{ category: 0x2000, targetUids: [darkTarget.uid], count: 1, player: 0, parameter: 0 }],
      player: 0,
      sourceUid: dharc.uid,
      targetFieldIds: [darkTarget.fieldId],
      targetUids: [darkTarget.uid],
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    passChain(restoredChain);

    expect(restoredChain.session.state.chain).toHaveLength(0);
    expect(restoredChain.host.messages).not.toContain("dharc chain responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === dharc.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(restoredChain.session.state.cards.find((card) => card.uid === darkTarget.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === darkTarget.uid)?.previousController).toBe(1);
    expect(restoredChain.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 4 && effect.sourceUid === darkTarget.uid)).toMatchObject({
      code: 4,
      controller: 1,
      event: "continuous",
      sourceUid: darkTarget.uid,
      value: 0,
    });
    expect(dharcCardTargets(restoredChain.session, dharc.uid)).toContain(darkTarget.uid);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === darkTarget.uid)).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: darkTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: dharc.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { controller: 0, location: "monsterZone", sequence: 1, position: "faceUpAttack", faceUp: true },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("dharc chain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
  }
}

function dharcCardTargets(session: DuelSession, dharcUid: string): string[] {
  const dharc = session.state.cards.find((card) => card.uid === dharcUid);
  return dharc?.cardTargetUids ?? [];
}
