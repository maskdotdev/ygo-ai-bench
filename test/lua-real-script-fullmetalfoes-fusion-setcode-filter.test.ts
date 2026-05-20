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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fullmetalfoes Fusion setcode filter", () => {
  it("restores Fusion.CreateSummonEff with a Metalfoes Fusion-target filter", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const fullmetalfoesFusionCode = "39564736";
    const materialACode = "39564737";
    const materialBCode = "39564738";
    const nonMetalfoesFusionCode = "39564739";
    const metalfoesFusionCode = "39564740";
    const responderCode = "39564741";
    const setMetalfoes = 0xe1;
    const upstreamFilterSnippet = "Fusion.CreateSummonEff(c,aux.FilterBoolFunction(Card.IsSetCard,SET_METALFOES))";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === fullmetalfoesFusionCode),
      { code: materialACode, name: "Fullmetalfoes Material A Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1000 },
      { code: materialBCode, name: "Fullmetalfoes Material B Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1300, defense: 1000 },
      {
        code: nonMetalfoesFusionCode,
        name: "Off-set Fusion Decoy",
        kind: "extra",
        typeFlags: 0x41,
        level: 6,
        attack: 2100,
        defense: 1800,
        fusionMaterialMin: 2,
        fusionMaterialMax: 2,
      },
      {
        code: metalfoesFusionCode,
        name: "Metalfoes Fusion Target Fixture",
        kind: "extra",
        typeFlags: 0x41,
        level: 6,
        attack: 2200,
        defense: 1800,
        setcodes: [setMetalfoes],
        fusionMaterialMin: 2,
        fusionMaterialMax: 2,
      },
      { code: responderCode, name: "Fullmetalfoes Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 395, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fullmetalfoesFusionCode, materialACode, materialBCode], extra: [nonMetalfoesFusionCode, metalfoesFusionCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const fusionSpell = requireCard(session, fullmetalfoesFusionCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const nonMetalfoesFusion = requireCard(session, nonMetalfoesFusionCode);
    const metalfoesFusion = requireCard(session, metalfoesFusionCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, fusionSpell.uid, "hand", 0);
    moveDuelCard(session.state, materialA.uid, "hand", 0);
    moveDuelCard(session.state, materialB.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fullmetalfoesFusionCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(workspace.readScript(`c${fullmetalfoesFusionCode}.lua`)).toContain(upstreamFilterSnippet);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === fusionSpell.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 },
    ]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === metalfoesFusion.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "fusion",
      summonMaterialUids: [materialA.uid, materialB.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === nonMetalfoesFusion.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
    });
    expect(restored.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.cards.find((card) => card.uid === materialB.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "usedAsMaterial")).toEqual([
      {
        eventName: "usedAsMaterial",
        eventCode: 1108,
        eventCardUid: materialA.uid,
        eventReason: duelReason.effect | duelReason.material | duelReason.fusion,
        eventReasonPlayer: 0,
        eventReasonCardUid: fusionSpell.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 1,
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
        eventName: "usedAsMaterial",
        eventCode: 1108,
        eventCardUid: materialB.uid,
        eventReason: duelReason.effect | duelReason.material | duelReason.fusion,
        eventReasonPlayer: 0,
        eventReasonCardUid: fusionSpell.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 2,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 1,
        },
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: metalfoesFusion.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.fusion,
        eventReasonPlayer: 0,
        eventReasonCardUid: fusionSpell.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "extraDeck",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restored.host.messages).not.toContain("fullmetalfoes responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("fullmetalfoes responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const result = applyResponse(session, action);
  expect(result.ok, result.error).toBe(true);
}
