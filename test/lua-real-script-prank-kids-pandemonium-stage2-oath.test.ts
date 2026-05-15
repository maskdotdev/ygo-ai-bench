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
const setPrankKids = 0x120;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Prank-Kids Pandemonium stage2 oath", () => {
  it("restores the post-Fusion Summon non-Prank-Kids Normal and Special Summon locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const pandemoniumCode = "79059098";
    const materialACode = "79059099";
    const materialBCode = "79059100";
    const fusionCode = "79059101";
    const nonPrankNormalCode = "79059102";
    const prankNormalCode = "79059103";
    const nonPrankSpecialCode = "79059104";
    const prankSpecialCode = "79059105";
    const responderCode = "79059106";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === pandemoniumCode),
      { code: materialACode, name: "Prank-Kids Pandemonium Material A", kind: "monster", typeFlags: 0x21, setcodes: [setPrankKids], level: 4, attack: 1000, defense: 1000 },
      { code: materialBCode, name: "Prank-Kids Pandemonium Material B", kind: "monster", typeFlags: 0x21, setcodes: [setPrankKids], level: 4, attack: 1100, defense: 1000 },
      {
        code: fusionCode,
        name: "Prank-Kids Pandemonium Fusion Fixture",
        kind: "extra",
        typeFlags: 0x41,
        setcodes: [setPrankKids],
        level: 8,
        attack: 3000,
        defense: 2500,
        fusionMaterials: [materialACode, materialBCode],
      },
      { code: nonPrankNormalCode, name: "Pandemonium Non-Prank Normal Candidate", kind: "monster", typeFlags: 0x21, level: 4, attack: 1200, defense: 1000 },
      { code: prankNormalCode, name: "Prank-Kids Normal Candidate", kind: "monster", typeFlags: 0x21, setcodes: [setPrankKids], level: 4, attack: 1300, defense: 1000 },
      { code: nonPrankSpecialCode, name: "Pandemonium Non-Prank Special Candidate", kind: "monster", typeFlags: 0x21, level: 4, attack: 1400, defense: 1000 },
      { code: prankSpecialCode, name: "Prank-Kids Special Candidate", kind: "monster", typeFlags: 0x21, setcodes: [setPrankKids], level: 4, attack: 1500, defense: 1000 },
      { code: responderCode, name: "Prank-Kids Pandemonium Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 790, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [pandemoniumCode, materialACode, materialBCode, nonPrankNormalCode, prankNormalCode, nonPrankSpecialCode, prankSpecialCode], extra: [fusionCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const pandemonium = session.state.cards.find((card) => card.code === pandemoniumCode);
    const materialA = session.state.cards.find((card) => card.code === materialACode);
    const materialB = session.state.cards.find((card) => card.code === materialBCode);
    const fusion = session.state.cards.find((card) => card.code === fusionCode);
    const nonPrankNormal = session.state.cards.find((card) => card.code === nonPrankNormalCode);
    const prankNormal = session.state.cards.find((card) => card.code === prankNormalCode);
    const nonPrankSpecial = session.state.cards.find((card) => card.code === nonPrankSpecialCode);
    const prankSpecial = session.state.cards.find((card) => card.code === prankSpecialCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(pandemonium).toBeDefined();
    expect(materialA).toBeDefined();
    expect(materialB).toBeDefined();
    expect(fusion).toBeDefined();
    expect(nonPrankNormal).toBeDefined();
    expect(prankNormal).toBeDefined();
    expect(nonPrankSpecial).toBeDefined();
    expect(prankSpecial).toBeDefined();
    expect(responder).toBeDefined();
    for (const card of [pandemonium, materialA, materialB, nonPrankNormal, prankNormal, nonPrankSpecial, prankSpecial]) {
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${nonPrankSpecialCode}.lua`) return specialSummonProcedureScript(nonPrankSpecialCode);
        if (name === `c${prankSpecialCode}.lua`) return specialSummonProcedureScript(prankSpecialCode);
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(pandemoniumCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(nonPrankSpecialCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(prankSpecialCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === pandemonium!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.host.messages).not.toContain("pandemonium responder resolved");

    const postResolutionRestored = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(postResolutionRestored.restoreComplete, postResolutionRestored.incompleteReasons.join("; ")).toBe(true);
    expect(postResolutionRestored.missingRegistryKeys).toEqual([]);
    expect(postResolutionRestored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(postResolutionRestored, 0);

    expect(postResolutionRestored.session.state.cards.find((card) => card.uid === fusion!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "fusion",
      summonMaterialUids: [materialA!.uid, materialB!.uid],
    });
    expect(postResolutionRestored.session.state.cards.find((card) => card.uid === materialA!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(postResolutionRestored.session.state.cards.find((card) => card.uid === materialB!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });

    expect(postResolutionRestored.session.state.effects.find((effect) => effect.sourceUid === pandemonium!.uid && effect.code === 22)).toMatchObject({
      event: "continuous",
      luaTargetDescriptor: "target:not-setcode:288",
      targetRange: [1, 0],
    });
    expect(postResolutionRestored.session.state.effects.find((effect) => effect.sourceUid === pandemonium!.uid && effect.code === 20)).toMatchObject({
      event: "continuous",
      luaTargetDescriptor: "target:not-setcode:288",
      targetRange: [1, 0],
    });

    const actions = getLuaRestoreLegalActions(postResolutionRestored, 0);
    expect(actions.some((action) => action.type === "normalSummon" && action.uid === nonPrankNormal!.uid)).toBe(false);
    expect(actions.some((action) => action.type === "normalSummon" && action.uid === prankNormal!.uid)).toBe(true);
    expect(actions.some((action) => action.type === "specialSummonProcedure" && action.uid === nonPrankSpecial!.uid)).toBe(false);
    expect(actions.some((action) => action.type === "specialSummonProcedure" && action.uid === prankSpecial!.uid)).toBe(true);
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
      e:SetOperation(function(e,tp) Debug.Message("pandemonium responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function specialSummonProcedureScript(code: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_FIELD)
      e:SetCode(EFFECT_SPSUMMON_PROC)
      e:SetRange(LOCATION_HAND)
      e:SetValue(function(e,c) return c:IsCode(id) end)
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
