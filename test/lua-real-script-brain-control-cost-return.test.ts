import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Brain Control cost return", () => {
  it("restores Brain Control's LP cost, summonable target filter, and End Phase return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const brainControlCode = "87910978";
    const targetCode = "612201";
    const responderCode = "612202";
    const extraTargetCode = "612203";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === brainControlCode),
      { code: targetCode, name: "Brain Control Normal Target", kind: "monster", typeFlags: 0x21, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Brain Control Chain Responder", kind: "monster", typeFlags: 0x21, level: 4 },
      { code: extraTargetCode, name: "Brain Control Extra Target", kind: "extra", typeFlags: 0x41, level: 4, attack: 1900, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 304, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [brainControlCode] }, 1: { main: [extraTargetCode, targetCode, responderCode] } });
    startDuel(session);

    const brainControl = session.state.cards.find((card) => card.code === brainControlCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const extraTarget = session.state.cards.find((card) => card.code === extraTargetCode);
    expect(brainControl).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    expect(extraTarget).toBeDefined();
    moveDuelCard(session.state, brainControl!.uid, "hand", 0);
    moveDuelCard(session.state, extraTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(brainControlCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === brainControl!.uid);
    expect(activation).toBeDefined();
    applyAndAssert(session, activation!);

    const openedSnapshot = serializeDuel(session);
    expect(openedSnapshot.state.players[0].lifePoints).toBe(7200);
    expect(openedSnapshot.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "lifePointCostPaid", eventCode: 1201, eventPlayer: 0, eventValue: 800, eventReason: 0x80, eventReasonPlayer: 0 })]),
    );
    expect(openedSnapshot.state.chain[0]).toMatchObject({
      sourceUid: brainControl!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x2000, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restoredResponseWindow = restoreDuelWithLuaScripts(openedSnapshot, source, reader);
    expect(restoredResponseWindow.restoreComplete, restoredResponseWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredResponseWindow.missingRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.session.state.players[0].lifePoints).toBe(7200);
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredResponseWindow.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredResponseWindow, 1));
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const pass = getLuaRestoreLegalActions(restoredResponseWindow, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredResponseWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restoredResponseWindow.host.messages).not.toContain("brain responder resolved");
    expect(restoredResponseWindow.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      controller: 0,
      previousController: 1,
      location: "monsterZone",
    });
    expect(restoredResponseWindow.session.state.cards.find((card) => card.uid === extraTarget!.uid)).toMatchObject({ controller: 1, location: "monsterZone" });
    expect(restoredResponseWindow.session.state.cards.find((card) => card.uid === brainControl!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredResponseWindow.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUid: target!.uid,
          registryKey: `lua:${targetCode}:temporary-control-return:${target!.uid}`,
          luaValueDescriptor: "temporary-control-return",
          value: 1,
        }),
      ]),
    );

    const restoredReturnWindow = restoreDuelWithLuaScripts(serializeDuel(restoredResponseWindow.session), source, reader);
    expect(restoredReturnWindow.restoreComplete, restoredReturnWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredReturnWindow.missingRegistryKeys).toEqual([]);
    expect(restoredReturnWindow.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ controller: 0, previousController: 1 });
    expect(restoredReturnWindow.session.state.players[0].lifePoints).toBe(7200);

    const endTurn = getLuaRestoreLegalActions(restoredReturnWindow, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const nextTurn = applyLuaRestoreResponse(restoredReturnWindow, endTurn!);
    expect(nextTurn.ok, nextTurn.error).toBe(true);
    expect(restoredReturnWindow.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      controller: 1,
      previousController: 0,
      location: "monsterZone",
    });
    expect(restoredReturnWindow.session.state.cards.find((card) => card.uid === extraTarget!.uid)).toMatchObject({ controller: 1, location: "monsterZone" });
    expect(restoredReturnWindow.session.state.effects.map((effect) => effect.registryKey)).not.toContain(`lua:${targetCode}:temporary-control-return:${target!.uid}`);
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
      e:SetOperation(function(e,tp) Debug.Message("brain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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
