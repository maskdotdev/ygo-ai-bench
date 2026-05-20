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
const noEntryCode = "60306104";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNoEntryScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${noEntryCode}.lua`));
const ownAttackCode = "603061040";
const ownDefenseCode = "603061041";
const opposingAttackCode = "603061042";
const responderCode = "603061043";
const typeMonster = 0x1;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasNoEntryScript)("Lua real script No Entry group position", () => {
  it("restores No Entry's free-chain all-field Attack Position group switch to Defense", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${noEntryCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_POSITION)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsPosition(POS_FACEUP_ATTACK) and c:IsCanChangePosition()");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_POSITION,g,#g,0,0)");
    expect(script).toContain("Duel.ChangePosition(g,POS_FACEUP_DEFENSE)");

    const cards: DuelCardData[] = [
      { code: noEntryCode, name: "No Entry!!", kind: "trap", typeFlags: typeTrap },
      { code: ownAttackCode, name: "No Entry Own Attack", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1700, defense: 1200 },
      { code: ownDefenseCode, name: "No Entry Own Defense", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1700 },
      { code: opposingAttackCode, name: "No Entry Opposing Attack", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1300 },
      { code: responderCode, name: "No Entry Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 60306104, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [noEntryCode, ownAttackCode, ownDefenseCode] }, 1: { main: [opposingAttackCode, responderCode] } });
    startDuel(session);

    const noEntry = requireCard(session, noEntryCode);
    const ownAttack = requireCard(session, ownAttackCode);
    const ownDefense = requireCard(session, ownDefenseCode);
    const opposingAttack = requireCard(session, opposingAttackCode);
    const responder = requireCard(session, responderCode);
    const movedNoEntry = moveDuelCard(session.state, noEntry.uid, "spellTrapZone", 0);
    movedNoEntry.position = "faceDown";
    movedNoEntry.faceUp = false;
    const movedOwnAttack = moveDuelCard(session.state, ownAttack.uid, "monsterZone", 0);
    movedOwnAttack.position = "faceUpAttack";
    movedOwnAttack.faceUp = true;
    movedOwnAttack.turnId = 0;
    const movedOwnDefense = moveDuelCard(session.state, ownDefense.uid, "monsterZone", 0);
    movedOwnDefense.position = "faceUpDefense";
    movedOwnDefense.faceUp = true;
    movedOwnDefense.turnId = 0;
    const movedOpposingAttack = moveDuelCard(session.state, opposingAttack.uid, "monsterZone", 1);
    movedOpposingAttack.position = "faceUpAttack";
    movedOpposingAttack.faceUp = true;
    movedOpposingAttack.turnId = 0;
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
    expect(host.loadCardScript(Number(noEntryCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const noEntryAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === noEntry.uid);
    expect(noEntryAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, noEntryAction!);
    expect(restoredOpen.session.state.chain).toHaveLength(1);
    const targetUids = [ownAttack.uid, opposingAttack.uid];
    expect(restoredOpen.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1000, targetUids, count: 2, player: 0, parameter: 0 },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    const responderAction = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "activateEffect" && action.uid === responder.uid);
    expect(responderAction).toBeDefined();
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass?.windowKind).toBe("chainResponse");
    applyLuaRestoreAndAssert(restoredChain, pass!);

    expect(restoredChain.session.state.chain).toHaveLength(0);
    expect(restoredChain.session.state.cards.find((card) => card.uid === noEntry.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === ownAttack.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpDefense", faceUp: true });
    expect(restoredChain.session.state.cards.find((card) => card.uid === ownDefense.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpDefense", faceUp: true });
    expect(restoredChain.session.state.cards.find((card) => card.uid === opposingAttack.uid)).toMatchObject({ location: "monsterZone", controller: 1, position: "faceUpDefense", faceUp: true });
    expect(restoredChain.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChain.host.messages).not.toContain("no entry responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "positionChanged")).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: ownAttack.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: noEntry.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 0,
        },
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: opposingAttack.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: noEntry.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 0,
        },
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: ownAttack.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: noEntry.uid,
        eventReasonEffectId: 1,
        eventUids: targetUids,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 0,
        },
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
      e:SetOperation(function(e,tp) Debug.Message("no entry responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
  return response;
}
