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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mind Control restrictions", () => {
  it("restores Mind Control's temporary control, unreleasable, and cannot-attack effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mindControlCode = "37520316";
    const targetCode = "612101";
    const responderCode = "612102";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mindControlCode),
      { code: targetCode, name: "Mind Control Target", kind: "monster", typeFlags: 0x21, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Mind Control Chain Responder", kind: "monster", typeFlags: 0x21, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 303, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mindControlCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const mindControl = session.state.cards.find((card) => card.code === mindControlCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(mindControl).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, mindControl!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(mindControlCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === mindControl!.uid);
    expect(activation).toBeDefined();
    applyAndAssert(session, activation!);

    const openedSnapshot = serializeDuel(session);
    expect(openedSnapshot.state.chain[0]).toMatchObject({
      sourceUid: mindControl!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x2000, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restoredResponseWindow = restoreDuelWithLuaScripts(openedSnapshot, source, reader);
    expect(restoredResponseWindow.restoreComplete, restoredResponseWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredResponseWindow.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredResponseWindow.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredResponseWindow, 1));
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const pass = getLuaRestoreLegalActions(restoredResponseWindow, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredResponseWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restoredResponseWindow.host.messages).not.toContain("mind responder resolved");
    expect(restoredResponseWindow.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      controller: 0,
      previousController: 1,
      location: "monsterZone",
    });
    expect(restoredResponseWindow.session.state.cards.find((card) => card.uid === mindControl!.uid)).toMatchObject({ location: "graveyard" });
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
    expect(restrictionCodes(restoredResponseWindow.session, target!.uid)).toEqual([43, 44, 85]);

    const restoredRestrictionWindow = restoreDuelWithLuaScripts(serializeDuel(restoredResponseWindow.session), source, reader);
    expect(restoredRestrictionWindow.restoreComplete, restoredRestrictionWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredRestrictionWindow.missingRegistryKeys).toEqual([]);
    expect(restoredRestrictionWindow.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ controller: 0, previousController: 1 });
    expect(restoredRestrictionWindow.session.state.effects.map((effect) => effect.registryKey)).toContain(`lua:${targetCode}:temporary-control-return:${target!.uid}`);
    expect(restrictionCodes(restoredRestrictionWindow.session, target!.uid)).toEqual([43, 44, 85]);

    const probe = restoredRestrictionWindow.host.loadScript(releaseProbeScript(targetCode), "mind-control-release-probe.lua");
    expect(probe.ok, probe.error).toBe(true);
    expect(restoredRestrictionWindow.host.messages).toContain("mind release probe true/false/0");

    const battle = getLuaRestoreLegalActions(restoredRestrictionWindow, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeDefined();
    const battleWindow = applyLuaRestoreResponse(restoredRestrictionWindow, battle!);
    expect(battleWindow.ok, battleWindow.error).toBe(true);
    expect(getLuaRestoreLegalActions(restoredRestrictionWindow, 0).some((action) => action.type === "declareAttack" && action.attackerUid === target!.uid)).toBe(false);

    const endTurn = getLuaRestoreLegalActions(restoredRestrictionWindow, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const nextTurn = applyLuaRestoreResponse(restoredRestrictionWindow, endTurn!);
    expect(nextTurn.ok, nextTurn.error).toBe(true);
    expect(restoredRestrictionWindow.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      controller: 1,
      previousController: 0,
      location: "monsterZone",
    });
    expect(restoredRestrictionWindow.session.state.effects.map((effect) => effect.registryKey)).not.toContain(`lua:${targetCode}:temporary-control-return:${target!.uid}`);
    expect(restrictionCodes(restoredRestrictionWindow.session, target!.uid)).toEqual([]);
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
      e:SetOperation(function(e,tp) Debug.Message("mind responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function releaseProbeScript(targetCode: string): string {
  return `
    local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
    Debug.Message("mind release probe " .. tostring(target~=nil) .. "/" .. tostring(Duel.IsPlayerCanRelease(0,target)) .. "/" .. Duel.GetReleaseGroupCount(0,aux.TRUE,nil))
  `;
}

function restrictionCodes(session: DuelSession, targetUid: string): number[] {
  return session.state.effects
    .filter((effect) => effect.sourceUid === targetUid && (effect.code === 43 || effect.code === 44 || effect.code === 85))
    .map((effect) => effect.code!)
    .sort((a, b) => a - b);
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
