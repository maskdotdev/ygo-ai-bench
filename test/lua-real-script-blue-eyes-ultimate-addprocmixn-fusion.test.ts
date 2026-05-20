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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Blue-Eyes Ultimate Dragon Fusion.AddProcMixN metadata", () => {
  it("restores current Fusion.AddProcMixN repeated code metadata and lets Polymerization summon Blue-Eyes Ultimate Dragon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const polymerizationCode = "24094653";
    const blueEyesUltimateCode = "23995346";
    const blueEyesCode = "89631139";
    const responderCode = "23995347";
    const wantedCodes = [polymerizationCode, blueEyesUltimateCode, blueEyesCode];
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => wantedCodes.includes(card.code)),
      { code: responderCode, name: "Blue-Eyes Ultimate MixN Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 23995346, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polymerizationCode, blueEyesCode, blueEyesCode, blueEyesCode], extra: [blueEyesUltimateCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const polymerization = session.state.cards.find((card) => card.code === polymerizationCode);
    const blueEyesUltimate = session.state.cards.find((card) => card.code === blueEyesUltimateCode);
    const blueEyesMaterials = session.state.cards.filter((card) => card.code === blueEyesCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(polymerization).toBeDefined();
    expect(blueEyesUltimate).toBeDefined();
    expect(blueEyesMaterials).toHaveLength(3);
    expect(responder).toBeDefined();
    moveDuelCard(session.state, polymerization!.uid, "hand", 0);
    for (const blueEyes of blueEyesMaterials) moveDuelCard(session.state, blueEyes.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(polymerizationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(blueEyesUltimateCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(workspace.readScript(`c${blueEyesUltimateCode}.lua`)).toContain("Fusion.AddProcMixN(c,true,true,CARD_BLUEEYES_W_DRAGON,3)");
    expect(blueEyesUltimate!.data.fusionMaterials).toEqual([blueEyesCode, blueEyesCode, blueEyesCode]);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === polymerization!.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === blueEyesUltimate!.uid)?.data.fusionMaterials).toEqual([blueEyesCode, blueEyesCode, blueEyesCode]);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 },
    ]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === blueEyesUltimate!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "fusion",
      summonMaterialUids: blueEyesMaterials.map((card) => card.uid),
    });
    for (const blueEyes of blueEyesMaterials) {
      expect(restored.session.state.cards.find((card) => card.uid === blueEyes.uid)).toMatchObject({
        location: "graveyard",
        controller: 0,
        reason: duelReason.effect | duelReason.material | duelReason.fusion,
      });
    }
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "usedAsMaterial").map((event) => event.eventCardUid)).toEqual(blueEyesMaterials.map((card) => card.uid));
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      cardUid: event.eventCardUid,
      reason: event.eventReason,
      reasonCardUid: event.eventReasonCardUid,
      reasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      {
        cardUid: blueEyesUltimate!.uid,
        reason: duelReason.summon | duelReason.specialSummon | duelReason.fusion,
        reasonCardUid: polymerization!.uid,
        reasonEffectId: 1,
      },
    ]);
    expect(restored.host.messages).not.toContain("blue-eyes ultimate mixn responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("blue-eyes ultimate mixn responder resolved") end)
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
}
