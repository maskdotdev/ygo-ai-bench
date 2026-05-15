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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Enemy Controller control cost", () => {
  it("restores Enemy Controller's release-cost control branch and End Phase return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const enemyControllerCode = "98045062";
    const releaseCode = "612301";
    const targetCode = "612302";
    const responderCode = "612303";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === enemyControllerCode),
      { code: releaseCode, name: "Enemy Controller Release Cost", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000 },
      { code: targetCode, name: "Enemy Controller Target", kind: "monster", typeFlags: 0x21, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Enemy Controller Chain Responder", kind: "monster", typeFlags: 0x21, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 305, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [enemyControllerCode, releaseCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const enemyController = session.state.cards.find((card) => card.code === enemyControllerCode);
    const releaseCost = session.state.cards.find((card) => card.code === releaseCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(enemyController).toBeDefined();
    expect(releaseCost).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, enemyController!.uid, "hand", 0);
    moveDuelCard(session.state, releaseCost!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.positionsChanged.push(target!.uid);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(enemyControllerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === enemyController!.uid);
    expect(activation).toBeDefined();
    applyAndAssert(session, activation!);

    const openedSnapshot = serializeDuel(session);
    expect(openedSnapshot.state.chain[0]).toMatchObject({
      sourceUid: enemyController!.uid,
      targetUids: [target!.uid],
      effectLabel: 2,
      operationInfos: [{ category: 0x2000, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 }],
    });
    expect(openedSnapshot.state.chain[0]?.operationInfos).not.toEqual(expect.arrayContaining([expect.objectContaining({ category: 0x1000 })]));
    expect(openedSnapshot.state.cards.find((card) => card.uid === releaseCost!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      previousController: 0,
      reasonPlayer: 0,
    });
    const released = openedSnapshot.state.cards.find((card) => card.uid === releaseCost!.uid);
    expect((released!.reason! & duelReason.release) !== 0).toBe(true);
    expect((released!.reason! & duelReason.cost) !== 0).toBe(true);
    expect(openedSnapshot.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "released", eventCode: 1017 })]));

    const restoredResponseWindow = restoreDuelWithLuaScripts(openedSnapshot, source, reader);
    expect(restoredResponseWindow.restoreComplete, restoredResponseWindow.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredResponseWindow, 1);
    expect(restoredResponseWindow.missingRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.session.state.chain[0]).toMatchObject({ effectLabel: 2, targetUids: [target!.uid] });
    expect(restoredResponseWindow.session.state.cards.find((card) => card.uid === releaseCost!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      previousController: 0,
    });
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const pass = getLuaRestoreLegalActions(restoredResponseWindow, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredResponseWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restoredResponseWindow.host.messages).not.toContain("enemy responder resolved");
    expect(restoredResponseWindow.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      controller: 0,
      previousController: 1,
      location: "monsterZone",
    });
    expect(restoredResponseWindow.session.state.cards.find((card) => card.uid === enemyController!.uid)).toMatchObject({ location: "graveyard" });
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
    expectRestoredLegalActions(restoredReturnWindow, 0);
    expect(restoredReturnWindow.missingRegistryKeys).toEqual([]);
    expect(restoredReturnWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredReturnWindow.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ controller: 0, previousController: 1 });

    const endTurn = getLuaRestoreLegalActions(restoredReturnWindow, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const nextTurn = applyLuaRestoreResponse(restoredReturnWindow, endTurn!);
    expect(nextTurn.ok, nextTurn.error).toBe(true);
    expect(restoredReturnWindow.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      controller: 1,
      previousController: 0,
      location: "monsterZone",
    });
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
      e:SetOperation(function(e,tp) Debug.Message("enemy responder resolved") end)
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
