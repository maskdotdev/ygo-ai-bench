import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Forbidden Droplet chain-limit restore", () => {
  it("restores Forbidden Droplet's cost type-mask response block and resolved stat effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dropletCode = "24299458";
    const costSpellCode = "611001";
    const targetCode = "611002";
    const allowedMonsterCode = "611003";
    const blockedSpellCode = "611004";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dropletCode),
      { code: costSpellCode, name: "Droplet Spell Cost", kind: "spell", typeFlags: 0x2 },
      { code: targetCode, name: "Droplet Negated Target", kind: "monster", typeFlags: 0x21, level: 4, attack: 2000, defense: 1000 },
      { code: allowedMonsterCode, name: "Droplet Allowed Monster Response", kind: "monster", typeFlags: 0x21, level: 4 },
      { code: blockedSpellCode, name: "Droplet Blocked Spell Response", kind: "spell", typeFlags: 0x2 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 301, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dropletCode, costSpellCode] }, 1: { main: [targetCode, allowedMonsterCode, blockedSpellCode] } });
    startDuel(session);

    const droplet = session.state.cards.find((card) => card.code === dropletCode);
    const costSpell = session.state.cards.find((card) => card.code === costSpellCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const allowedMonster = session.state.cards.find((card) => card.code === allowedMonsterCode);
    const blockedSpell = session.state.cards.find((card) => card.code === blockedSpellCode);
    expect(droplet).toBeDefined();
    expect(costSpell).toBeDefined();
    expect(target).toBeDefined();
    expect(allowedMonster).toBeDefined();
    expect(blockedSpell).toBeDefined();
    moveDuelCard(session.state, droplet!.uid, "hand", 0);
    moveDuelCard(session.state, costSpell!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, allowedMonster!.uid, "hand", 1);
    moveDuelCard(session.state, blockedSpell!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${allowedMonsterCode}.lua`) return chainResponderScript("allowed monster response resolved");
        if (name === `c${blockedSpellCode}.lua`) return chainResponderScript("blocked spell response resolved");
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dropletCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedMonsterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(blockedSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const dropletAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === droplet!.uid);
    expect(dropletAction).toBeDefined();
    applyAndAssert(session, dropletAction!);

    const registryKey = `lua-chain-limit:${dropletCode}:0:link:known:closure:original-type-mask-response-player:2`;
    const openedSnapshot = serializeDuel(session);
    expect(openedSnapshot.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(openedSnapshot.state.chain[0]).toMatchObject({
      sourceUid: droplet!.uid,
      operationInfos: [{ category: 0x4000, targetUids: [], count: 1, player: 0, parameter: 0 }],
    });
    expect(session.state.cards.find((card) => card.uid === costSpell!.uid)).toMatchObject({ location: "graveyard", reason: 0x80 });
    expect(hasEffect(getLegalActions(session, 1), blockedSpell!.uid)).toBe(false);
    expect(hasEffect(getLegalActions(session, 1), allowedMonster!.uid)).toBe(true);

    const restoredResponseWindow = restoreDuelWithLuaScripts(openedSnapshot, source, reader);
    expectRestoredChainLimit(restoredResponseWindow, registryKey);
    expect(hasRestoreEffect(restoredResponseWindow, 1, blockedSpell!.uid)).toBe(false);
    expect(hasRestoreEffect(restoredResponseWindow, 1, allowedMonster!.uid)).toBe(true);

    const pass = getLuaRestoreLegalActions(restoredResponseWindow, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredResponseWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restoredResponseWindow.session.state.cards.find((card) => card.uid === droplet!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredResponseWindow.host.messages).not.toContain("blocked spell response resolved");
    expect(restoredResponseWindow.host.messages).not.toContain("allowed monster response resolved");

    const restoredResolvedState = restoreDuelWithLuaScripts(serializeDuel(restoredResponseWindow.session), source, reader);
    expect(restoredResolvedState.restoreComplete, restoredResolvedState.incompleteReasons.join("; ")).toBe(true);
    expectLuaTargetProbe(restoredResolvedState, targetCode, "droplet target probe 1000/true");
  });
});

function chainResponderScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
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

function expectRestoredChainLimit(restored: ReturnType<typeof restoreDuelWithLuaScripts>, registryKey: string): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
  for (const player of [0, 1] as const) {
    expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
    expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
  }
}

function hasEffect(actions: ReturnType<typeof getLegalActions>, uid: string): boolean {
  return actions.some((action) => action.type === "activateEffect" && action.uid === uid);
}

function hasRestoreEffect(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, uid: string): boolean {
  return getLuaRestoreLegalActions(restored, player).some((action) => action.type === "activateEffect" && action.uid === uid);
}

function expectLuaTargetProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, targetCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${targetCode}),1,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("droplet target probe " .. target:GetAttack() .. "/" .. tostring(target:IsDisabled()))
    `,
    "forbidden-droplet-target-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
