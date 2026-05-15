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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dark Fusion stage2 protection", () => {
  it("restores opponent targeting protection granted to the summoned Fusion monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const darkFusionCode = "94820406";
    const materialACode = "9482";
    const materialBCode = "9483";
    const fusionCode = "9484";
    const turnQuickCode = "9485";
    const opponentTargetCode = "9486";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === darkFusionCode),
      { code: materialACode, name: "Dark Fusion Material A", kind: "monster", typeFlags: 0x21, race: 0x8, level: 4, attack: 1200, defense: 1000 },
      { code: materialBCode, name: "Dark Fusion Material B", kind: "monster", typeFlags: 0x21, race: 0x8, level: 4, attack: 1300, defense: 1000 },
      {
        code: fusionCode,
        name: "Dark Fusion Fiend Target Fixture",
        kind: "extra",
        typeFlags: 0x41,
        race: 0x8,
        level: 6,
        attack: 2400,
        defense: 2000,
        fusionMaterials: [materialACode, materialBCode],
      },
      { code: turnQuickCode, name: "Dark Fusion Turn Quick Probe", kind: "monster", typeFlags: 0x21, level: 4 },
      { code: opponentTargetCode, name: "Dark Fusion Opponent Target Probe", kind: "monster", typeFlags: 0x21, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 948, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [darkFusionCode, materialACode, materialBCode, turnQuickCode], extra: [fusionCode] }, 1: { main: [opponentTargetCode] } });
    startDuel(session);

    const darkFusion = session.state.cards.find((card) => card.code === darkFusionCode);
    const materialA = session.state.cards.find((card) => card.code === materialACode);
    const materialB = session.state.cards.find((card) => card.code === materialBCode);
    const fusion = session.state.cards.find((card) => card.code === fusionCode);
    const turnQuick = session.state.cards.find((card) => card.code === turnQuickCode);
    const opponentTarget = session.state.cards.find((card) => card.code === opponentTargetCode);
    expect(darkFusion).toBeDefined();
    expect(materialA).toBeDefined();
    expect(materialB).toBeDefined();
    expect(fusion).toBeDefined();
    expect(turnQuick).toBeDefined();
    expect(opponentTarget).toBeDefined();
    moveDuelCard(session.state, darkFusion!.uid, "hand", 0);
    moveDuelCard(session.state, materialA!.uid, "hand", 0);
    moveDuelCard(session.state, materialB!.uid, "hand", 0);
    moveDuelCard(session.state, turnQuick!.uid, "graveyard", 0);
    moveDuelCard(session.state, opponentTarget!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${turnQuickCode}.lua`) return turnQuickScript();
        if (name === `c${opponentTargetCode}.lua`) return opponentTargetScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(darkFusionCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(turnQuickCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentTargetCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === darkFusion!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    const responsePlayer = restoredChain.session.state.waitingFor;
    expect(responsePlayer).toBeDefined();
    expectRestoredLegalActions(restoredChain, responsePlayer!);

    const pass = getLuaRestoreLegalActions(restoredChain, responsePlayer!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChain, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restoredChain.session.state.cards.find((card) => card.uid === fusion!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "fusion",
      summonMaterialUids: [materialA!.uid, materialB!.uid],
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === materialA!.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === materialB!.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restoredChain.session.state.effects.find((effect) => effect.sourceUid === fusion!.uid && effect.code === 71)).toMatchObject({
      event: "continuous",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
    });

    const restoredProtected = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredProtected.restoreComplete, restoredProtected.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredProtected, 0);
    expect(restoredProtected.missingRegistryKeys).toEqual([]);
    expect(restoredProtected.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredProtected.session.state.effects.find((effect) => effect.sourceUid === fusion!.uid && effect.code === 71)).toMatchObject({
      event: "continuous",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
    });

    const startChain = getLuaRestoreLegalActions(restoredProtected, 0).find((action) => action.type === "activateEffect" && action.uid === turnQuick!.uid);
    expect(startChain).toBeDefined();
    const started = applyLuaRestoreResponse(restoredProtected, startChain!);
    expect(started.ok, started.error).toBe(true);
    expect(restoredProtected.session.state.chain).toHaveLength(1);
    expect(getLuaRestoreLegalActions(restoredProtected, 1).find((action) => action.type === "activateEffect" && action.uid === opponentTarget!.uid)).toBeUndefined();
    expect(restoredProtected.host.messages).not.toContain("dark fusion target responder resolved");
  });
});

function turnQuickScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_GRAVE)
      e:SetOperation(function(e,tp) Debug.Message("dark fusion turn quick resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function opponentTargetScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetTarget(s.tg)
      e:SetOperation(function(e,tp) Debug.Message("dark fusion target responder resolved") end)
      c:RegisterEffect(e)
    end
    function s.filter(c,e)
      return c:IsFaceup() and c:IsCanBeEffectTarget(e)
    end
    function s.tg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
      if chkc then return chkc:IsControler(1-tp) and chkc:IsLocation(LOCATION_MZONE) and s.filter(chkc,e) end
      if chk==0 then return Duel.IsExistingTarget(s.filter,tp,0,LOCATION_MZONE,1,nil,e) end
      Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TARGET)
      local g=Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil,e)
      Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)
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
