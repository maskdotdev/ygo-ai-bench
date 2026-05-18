import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Windstorm of Etaqua group position", () => {
  it("restores Windstorm of Etaqua's opponent-only group position switch", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const windstormCode = "59744639";
    const attackTargetCode = "59744640";
    const defenseTargetCode = "59744641";
    const ownDecoyCode = "59744642";
    const responderCode = "59744643";
    const script = workspace.readScript(`c${windstormCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_POSITION)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsFaceup() and c:IsCanChangePosition()");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,0,LOCATION_MZONE,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_POSITION,sg,#sg,0,0)");
    expect(script).toContain("Duel.ChangePosition(sg,POS_FACEUP_DEFENSE,0,POS_FACEUP_ATTACK,0)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === windstormCode),
      { code: attackTargetCode, name: "Windstorm Attack Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1700, defense: 1200 },
      { code: defenseTargetCode, name: "Windstorm Defense Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1700 },
      { code: ownDecoyCode, name: "Windstorm Own Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1500 },
      { code: responderCode, name: "Windstorm Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 59744639, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [windstormCode, ownDecoyCode] }, 1: { main: [attackTargetCode, defenseTargetCode, responderCode] } });
    startDuel(session);

    const windstorm = requireCard(session, windstormCode);
    const attackTarget = requireCard(session, attackTargetCode);
    const defenseTarget = requireCard(session, defenseTargetCode);
    const ownDecoy = requireCard(session, ownDecoyCode);
    const responder = requireCard(session, responderCode);
    const movedWindstorm = moveDuelCard(session.state, windstorm.uid, "spellTrapZone", 0);
    movedWindstorm.position = "faceDown";
    movedWindstorm.faceUp = false;
    const movedAttackTarget = moveDuelCard(session.state, attackTarget.uid, "monsterZone", 1);
    movedAttackTarget.position = "faceUpAttack";
    movedAttackTarget.faceUp = true;
    movedAttackTarget.turnId = 0;
    const movedDefenseTarget = moveDuelCard(session.state, defenseTarget.uid, "monsterZone", 1);
    movedDefenseTarget.position = "faceUpDefense";
    movedDefenseTarget.faceUp = true;
    movedDefenseTarget.turnId = 0;
    const movedOwnDecoy = moveDuelCard(session.state, ownDecoy.uid, "monsterZone", 0);
    movedOwnDecoy.position = "faceUpAttack";
    movedOwnDecoy.faceUp = true;
    movedOwnDecoy.turnId = 0;
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
    expect(host.loadCardScript(Number(windstormCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpen.restoreComplete, restoredOpen.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpen.missingRegistryKeys).toEqual([]);
    expect(restoredOpen.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredOpen, 0)).toEqual(getGroupedDuelLegalActions(restoredOpen.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredOpen, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredOpen, 0));

    const windstormAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === windstorm.uid);
    expect(windstormAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, windstormAction!);
    expect(restoredOpen.session.state.chain).toHaveLength(1);
    const targetUids = [attackTarget.uid, defenseTarget.uid];
    expect(restoredOpen.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1000, targetUids, count: 2, player: 0, parameter: 0 },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChain, 1));
    expect(restoredChain.session.state.chain).toHaveLength(1);
    expect(restoredChain.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1000, targetUids, count: 2, player: 0, parameter: 0 },
    ]);
    const responderAction = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "activateEffect" && action.uid === responder.uid);
    expect(responderAction).toBeDefined();
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass?.windowKind).toBe("chainResponse");
    const resolved = applyLuaRestoreResponse(restoredChain, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restoredChain.session.state.chain).toHaveLength(0);
    expect(restoredChain.session.state.cards.find((card) => card.uid === windstorm.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === attackTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1, position: "faceUpDefense", faceUp: true });
    expect(restoredChain.session.state.cards.find((card) => card.uid === defenseTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1, position: "faceUpAttack", faceUp: true });
    expect(restoredChain.session.state.cards.find((card) => card.uid === ownDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true });
    expect(restoredChain.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChain.host.messages).not.toContain("windstorm responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "positionChanged")).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: attackTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: windstorm.uid,
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
        eventCardUid: defenseTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: windstorm.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: attackTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventReasonCardUid: windstorm.uid,
        eventReasonEffectId: 1,
        eventUids: targetUids,
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
      e:SetOperation(function(e,tp) Debug.Message("windstorm responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
