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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Monster Reborn free chain", () => {
  it("restores Monster Reborn's Graveyard target and Special Summons it on resolution", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const monsterRebornCode = "83764718";
    const responderCode = "860";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === monsterRebornCode),
      { code: responderCode, name: "Monster Reborn Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: "200", name: "Monster Reborn Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 460, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [monsterRebornCode] }, 1: { main: [responderCode, "200"] } });
    startDuel(session);

    const monsterReborn = session.state.cards.find((card) => card.code === monsterRebornCode);
    const target = session.state.cards.find((card) => card.code === "200");
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(monsterReborn).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, monsterReborn!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    moveDuelCard(session.state, target!.uid, "graveyard", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(monsterRebornCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const rebornAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === monsterReborn!.uid);
    expect(rebornAction).toBeDefined();
    applyAndAssert(session, rebornAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: monsterReborn!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x200, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toMatchObject({
      sourceUid: monsterReborn!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x200, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      controller: 0,
      location: "monsterZone",
      position: "faceUpAttack",
      faceUp: true,
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === monsterReborn!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.host.messages).not.toContain("monster reborn responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("monster reborn responder resolved") end)
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
