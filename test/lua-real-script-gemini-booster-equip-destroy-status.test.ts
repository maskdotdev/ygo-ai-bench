import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gemini Booster", () => {
  it("restores remain-field Trap equip, destruction, and Gemini-status trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const boosterCode = "18096222";
    const slimeCode = "3918345";
    const soldierCode = "68366996";
    const responderCode = "18096223";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [boosterCode, slimeCode, soldierCode].includes(card.code)),
      { code: responderCode, name: "Gemini Booster Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1809, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [boosterCode, slimeCode, soldierCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const booster = session.state.cards.find((card) => card.code === boosterCode);
    const slime = session.state.cards.find((card) => card.code === slimeCode);
    const soldier = session.state.cards.find((card) => card.code === soldierCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(booster).toBeDefined();
    expect(slime).toBeDefined();
    expect(soldier).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, booster!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, slime!.uid, "monsterZone", 0);
    moveDuelCard(session.state, soldier!.uid, "monsterZone", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    booster!.faceUp = false;
    slime!.faceUp = true;
    slime!.position = "faceUpAttack";
    soldier!.faceUp = true;
    soldier!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(boosterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredActivation, 0);
    assertGeminiStatus(restoredActivation, slimeCode, false);
    const activate = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === booster!.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivation, activate!);
    expect(restoredActivation.session.state.chain[0]).toMatchObject({
      sourceUid: booster!.uid,
      targetUids: [slime!.uid],
      operationInfos: [{ category: 0x40000, targetUids: [booster!.uid], count: 1, player: 0, parameter: 0 }],
    });
    expect(restoredActivation.session.state.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: booster!.uid, event: "continuous", code: 17, range: ["spellTrapZone"] })]),
    );

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("gemini booster responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === booster!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: slime!.uid,
      faceUp: true,
    });
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === slime!.uid), restoredChain.session.state)).toBe((slime!.data.attack ?? 0) + 700);

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredEquipped.restoreComplete, restoredEquipped.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipped.missingRegistryKeys).toEqual([]);
    expect(restoredEquipped.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquipped, 0);
    expect(restoredEquipped.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: booster!.uid, event: "continuous", code: 100, value: 700 }),
        expect.objectContaining({ sourceUid: booster!.uid, event: "continuous", code: 76 }),
      ]),
    );

    destroyDuelCard(restoredEquipped.session.state, booster!.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === booster!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      previousEquippedToUid: slime!.uid,
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(currentAttack(restoredEquipped.session.state.cards.find((card) => card.uid === slime!.uid), restoredEquipped.session.state)).toBe(slime!.data.attack ?? 0);
    expect(restoredEquipped.session.state.pendingTriggers).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: booster!.uid, eventName: "leftField", eventCode: 1015, player: 0 })]),
    );

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), source, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === booster!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain[0]).toMatchObject({
      sourceUid: booster!.uid,
      eventName: "leftField",
      eventCode: 1015,
      targetUids: [slime!.uid],
    });

    const restoredStatusChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expect(restoredStatusChain.restoreComplete, restoredStatusChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredStatusChain.missingRegistryKeys).toEqual([]);
    expect(restoredStatusChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredStatusChain, 1);
    resolveRestoredChain(restoredStatusChain);
    assertGeminiStatus(restoredStatusChain, slimeCode, true);
    expect(restoredStatusChain.session.state.flagEffects).toEqual(
      expect.arrayContaining([expect.objectContaining({ ownerType: "card", ownerId: slime!.uid, code: 0, property: 0x4000000, value: 0 })]),
    );

    const restoredAfterStatus = restoreDuelWithLuaScripts(serializeDuel(restoredStatusChain.session), source, reader);
    expect(restoredAfterStatus.restoreComplete, restoredAfterStatus.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterStatus.missingRegistryKeys).toEqual([]);
    expect(restoredAfterStatus.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredAfterStatus, 0);
    assertGeminiStatus(restoredAfterStatus, slimeCode, true);
    expect(restoredAfterStatus.host.messages).not.toContain("gemini booster responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("gemini booster responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function assertGeminiStatus(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: boolean): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${code}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("gemini booster status " .. tostring(target and target:IsGeminiStatus()))
    `,
    `gemini-booster-status-${expected ? "true" : "false"}.lua`,
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`gemini booster status ${expected ? "true" : "false"}`);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
