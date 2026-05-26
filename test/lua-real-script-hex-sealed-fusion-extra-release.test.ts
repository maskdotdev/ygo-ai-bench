import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeFusion = 0x40;
const attributeLight = 0x10;
const categorySpecialSummon = 0x200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Hex-Sealed Fusion extra release", () => {
  it("restores fusion substitute extra-release cost and Special Summons from the Extra Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const hexSealedCode = "15717011";
    const namedMaterialCode = "15717012";
    const opponentMaterialCode = "15717013";
    const lockedOpponentCode = "15717014";
    const targetFusionCode = "15717015";
    const responderCode = "15717016";
    const script = workspace.readScript(`c${hexSealedCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e2:SetCode(EFFECT_FUSION_SUBSTITUTE)");
    expect(script).toContain("return e:GetHandler():IsLocation(LOCATION_GRAVE|LOCATION_SZONE|LOCATION_MZONE|LOCATION_HAND)");
    expect(script).toContain("c:CheckFusionMaterial(m,gc,chkf)");
    expect(script).toContain("c:IsHasEffect(EFFECT_EXTRA_RELEASE_NONSUM)");
    expect(script).toContain("Fusion.CheckAdditional=s.fcheck(mg2)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_EXTRA,0,1,1,nil,e,tp,mg+mg2,c,chkf)");
    expect(script).toContain("Duel.SelectFusionMaterial(tp,g:GetFirst(),mg+mg2,c,chkf)");
    expect(script).toContain("eff:UseCountLimit(tp,1)");
    expect(script).toContain("Duel.Release(mat,REASON_COST)");
    expect(script).toContain("Duel.GetLocationCountFromEx(tp,rp,nil,c)>0");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === hexSealedCode),
      { code: namedMaterialCode, name: "Hex-Sealed Named Material", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1200 },
      { code: opponentMaterialCode, name: "Hex-Sealed Opponent Extra Material", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1000 },
      { code: lockedOpponentCode, name: "Hex-Sealed Locked Opponent Material", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      {
        code: targetFusionCode,
        name: "Hex-Sealed LIGHT Fusion Target",
        kind: "extra",
        typeFlags: typeMonster | typeFusion,
        attribute: attributeLight,
        level: 6,
        attack: 2400,
        defense: 2000,
        fusionMaterials: [namedMaterialCode, opponentMaterialCode],
      },
      { code: responderCode, name: "Hex-Sealed Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 15717011, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [hexSealedCode], extra: [targetFusionCode] },
      1: { main: [opponentMaterialCode, lockedOpponentCode, responderCode] },
    });
    startDuel(session);

    const hexSealed = requireCard(session, hexSealedCode);
    const opponentMaterial = requireCard(session, opponentMaterialCode);
    const lockedOpponent = requireCard(session, lockedOpponentCode);
    const targetFusion = requireCard(session, targetFusionCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, hexSealed.uid, "monsterZone", 0).sequence = 0;
    moveDuelCard(session.state, opponentMaterial.uid, "monsterZone", 1).sequence = 0;
    moveDuelCard(session.state, lockedOpponent.uid, "monsterZone", 1).sequence = 1;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${opponentMaterialCode}.lua`) return extraReleaseScript(opponentMaterialCode, 1);
        if (name === `c${lockedOpponentCode}.lua`) return extraReleaseScript(lockedOpponentCode, 0);
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [hexSealedCode, opponentMaterialCode, lockedOpponentCode, responderCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const restoredActivationWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivationWindow);
    expectRestoredLegalActions(restoredActivationWindow, 0);
    const activateHexSealed = getLuaRestoreLegalActions(restoredActivationWindow, 0).find(
      (action) => action.type === "activateEffect" && action.uid === hexSealed.uid,
    );
    expect(activateHexSealed, JSON.stringify(getLuaRestoreLegalActions(restoredActivationWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivationWindow, activateHexSealed!);
    expect(restoredActivationWindow.session.state.chain).toEqual([
      {
        id: "chain-4",
        chainIndex: 1,
        effectId: "lua-1",
        effectLabel: Number(targetFusionCode),
        sourceUid: hexSealed.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        operationInfos: [{ category: categorySpecialSummon, targetUids: [], count: 1, player: 0, parameter: 0x40 }],
      },
    ]);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredActivationWindow.session), source, reader);
    expectCleanRestore(restoredChainWindow);
    expectRestoredLegalActions(restoredChainWindow, 1);
    expect(getLuaRestoreLegalActions(restoredChainWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passChain(restoredChainWindow);

    expect(restoredChainWindow.session.state.chain).toHaveLength(0);
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === hexSealed.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      controller: 0,
      reason: duelReason.release | duelReason.cost,
    });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === opponentMaterial.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      controller: 1,
      reason: duelReason.release | duelReason.cost,
    });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === lockedOpponent.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      sequence: 1,
    });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === targetFusion.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      summonMaterialUids: [],
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: hexSealed.uid,
      reasonEffectId: 1,
    });
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === targetFusion.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: targetFusion.uid,
        eventUids: [targetFusion.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: hexSealed.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredChainWindow.host.messages).not.toContain("hex-sealed responder resolved");
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function extraReleaseScript(code: string, value: 0 | 1): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_EXTRA_RELEASE_NONSUM)
      e:SetCountLimit(1)
      e:SetValue(${value})
      c:RegisterEffect(e)
    end
  `;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("hex-sealed responder resolved") end)
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

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.legalActions).toEqual(getLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
