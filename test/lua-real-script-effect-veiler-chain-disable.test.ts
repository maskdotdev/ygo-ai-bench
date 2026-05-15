import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts, type LuaSnapshotRestoreResult } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Effect Veiler", () => {
  it("restores its hand quick effect and negates the related monster chain link", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const effectVeilerCode = "97268402";
    const targetCode = "916";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === effectVeilerCode),
      { code: targetCode, name: "Veiler Target Effect Monster", kind: "monster", typeFlags: 0x21, level: 4, attack: 1800, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 972, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [targetCode] }, 1: { main: [effectVeilerCode] } });
    startDuel(session);

    const target = session.state.cards.find((card) => card.code === targetCode);
    const effectVeiler = session.state.cards.find((card) => card.code === effectVeilerCode);
    expect(target).toBeDefined();
    expect(effectVeiler).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    moveDuelCard(session.state, effectVeiler!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${targetCode}.lua`) return veilerTargetScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(targetCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(effectVeilerCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const targetAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === target!.uid);
    expect(targetAction).toBeDefined();
    applyAndAssert(session, targetAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({ sourceUid: target!.uid });

    const veilerAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === effectVeiler!.uid);
    expect(veilerAction).toBeDefined();
    applyAndAssert(session, veilerAction!);
    expect(session.state.cards.find((card) => card.uid === effectVeiler!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.chain).toHaveLength(2);
    expect(session.state.chain[1]).toMatchObject({
      sourceUid: effectVeiler!.uid,
      targetUids: [target!.uid],
      operationInfos: [{ category: 0x4000, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    const responsePlayer = restored.session.state.waitingFor;
    expect(responsePlayer).toBeDefined();
    expect(getLuaRestoreLegalActionGroups(restored, responsePlayer!)).toEqual(getGroupedDuelLegalActions(restored.session, responsePlayer!));
    expect(getLuaRestoreLegalActionGroups(restored, responsePlayer!).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, responsePlayer!));

    resolveOpenChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === effectVeiler!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.host.messages).not.toContain("veiler target resolved");
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "chainNegated" }), expect.objectContaining({ eventName: "chainDisabled" })]),
    );

    const probe = restored.host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${targetCode}), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("veiler target disabled " .. tostring(target:IsDisabled()))
      `,
      "effect-veiler-disabled-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("veiler target disabled true");
  });
});

function veilerTargetScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        Debug.Message("veiler target resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
}

function resolveOpenChain(restored: LuaSnapshotRestoreResult): void {
  for (let index = 0; index < 8 && restored.session.state.chain.length > 0; index += 1) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
  }
  expect(restored.session.state.chain).toHaveLength(0);
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
