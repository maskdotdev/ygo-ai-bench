import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Armor Break equip active-type negate", () => {
  it("restores an IsActiveType(TYPE_EQUIP) activation response that negates, destroys, and suppresses the Equip operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const axeCode = "40619825";
    const armorBreakCode = "79649195";
    const targetCode = "79649196";
    const responderCode = "79649197";
    const script = workspace.readScript(`c${armorBreakCode}.lua`);
    expect(script).toContain("re:IsActiveType(TYPE_EQUIP)");
    expect(script).toContain("Duel.IsChainNegatable(ev)");
    expect(script).toContain("Duel.NegateActivation(ev)");
    expect(script).toContain("Duel.Destroy(eg,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [axeCode, armorBreakCode].includes(card.code)),
      { code: targetCode, name: "Armor Break Equip Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Armor Break Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7964, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [axeCode, targetCode, responderCode] }, 1: { main: [armorBreakCode] } });
    startDuel(session);

    const axe = requireCard(session, axeCode);
    const armorBreak = requireCard(session, armorBreakCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, axe.uid, "hand", 0);
    moveDuelCard(session.state, target.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 0);
    moveDuelCard(session.state, armorBreak.uid, "spellTrapZone", 1);
    armorBreak.position = "faceDown";
    armorBreak.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [axeCode, armorBreakCode, responderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredEquipWindow);
    expectRestoredLegalActions(restoredEquipWindow, 0);
    const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === axe.uid);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);
    expect(restoredEquipWindow.session.state.chain).toHaveLength(1);
    expect(restoredEquipWindow.session.state.chain[0]).toEqual({
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      id: "chain-2",
      operationInfos: [{ category: 0x40000, targetUids: [axe.uid], count: 1, player: 0, parameter: 0 }],
      player: 0,
      sourceUid: axe.uid,
      targetUids: [target.uid],
    });

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expectCleanRestore(restoredOpenChain);
    expectRestoredLegalActions(restoredOpenChain, 1);
    const armorBreakAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === armorBreak.uid);
    expect(armorBreakAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpenChain, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenChain, armorBreakAction!);
    expect(restoredOpenChain.session.state.chain).toHaveLength(2);
    expect(restoredOpenChain.session.state.chain[1]).toEqual({
      activationLocation: "spellTrapZone",
      activationSequence: 0,
      chainIndex: 2,
      effectId: "lua-6-1027",
      id: "chain-3",
      operationInfos: [
        { category: 0x10000000, targetUids: [axe.uid], count: 1, player: 0, parameter: 0 },
        { category: 0x1, targetUids: [axe.uid], count: 1, player: 0, parameter: 0 },
      ],
      player: 1,
      sourceUid: armorBreak.uid,
    });

    const restoredPendingResolution = restoreDuelWithLuaScripts(serializeDuel(restoredOpenChain.session), source, reader);
    expectCleanRestore(restoredPendingResolution);
    expectRestoredLegalActions(restoredPendingResolution, 0);
    expect(getLuaRestoreLegalActions(restoredPendingResolution, 0).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredPendingResolution);

    expect(restoredPendingResolution.session.state.chain).toHaveLength(0);
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === axe.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === armorBreak.uid)).toMatchObject({ location: "graveyard" });
    const restoredTarget = restoredPendingResolution.session.state.cards.find((card) => card.uid === target.uid);
    expect(restoredTarget).toMatchObject({ location: "monsterZone" });
    expect(restoredTarget?.equippedToUid).toBeUndefined();
    expect(currentAttack(restoredTarget, restoredPendingResolution.session.state)).toBe(1000);
    expect(restoredPendingResolution.host.messages).not.toContain("armor break chain responder resolved");
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: axe.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: armorBreak.uid,
        eventReasonEffectId: 6,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 1,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 1,
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
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>1 end)
      e:SetOperation(function(e,tp) Debug.Message("armor break chain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
