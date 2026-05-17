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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cyber End Dragon Fusion.AddProcMixN metadata", () => {
  it("restores exact repeated Fusion.AddProcMixN material metadata and lets Polymerization summon Cyber End Dragon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const polymerizationCode = "24094653";
    const cyberEndCode = "1546123";
    const cyberDragonCode = "70095154";
    const responderCode = "1546124";
    const wantedCodes = [polymerizationCode, cyberEndCode, cyberDragonCode];
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => wantedCodes.includes(card.code)),
      { code: responderCode, name: "Cyber End Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1546123, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [polymerizationCode, cyberDragonCode, cyberDragonCode, cyberDragonCode], extra: [cyberEndCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const polymerization = session.state.cards.find((card) => card.code === polymerizationCode);
    const cyberEnd = session.state.cards.find((card) => card.code === cyberEndCode);
    const cyberDragons = session.state.cards.filter((card) => card.code === cyberDragonCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(polymerization).toBeDefined();
    expect(cyberEnd).toBeDefined();
    expect(cyberDragons).toHaveLength(3);
    expect(responder).toBeDefined();
    moveDuelCard(session.state, polymerization!.uid, "hand", 0);
    for (const cyberDragon of cyberDragons) moveDuelCard(session.state, cyberDragon.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(cyberEndCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(cyberEnd!.data.fusionMaterials).toEqual([cyberDragonCode, cyberDragonCode, cyberDragonCode]);

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
    expect(restored.session.state.cards.find((card) => card.uid === cyberEnd!.uid)?.data.fusionMaterials).toEqual([cyberDragonCode, cyberDragonCode, cyberDragonCode]);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 },
    ]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === cyberEnd!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "fusion",
      summonMaterialUids: cyberDragons.map((card) => card.uid),
    });
    for (const cyberDragon of cyberDragons) {
      expect(restored.session.state.cards.find((card) => card.uid === cyberDragon.uid)).toMatchObject({
        location: "graveyard",
        controller: 0,
        reason: duelReason.effect | duelReason.material | duelReason.fusion,
      });
    }
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "usedAsMaterial").map((event) => event.eventCardUid)).toEqual(cyberDragons.map((card) => card.uid));
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      cardUid: event.eventCardUid,
      reason: event.eventReason,
      reasonCardUid: event.eventReasonCardUid,
      reasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      {
        cardUid: cyberEnd!.uid,
        reason: duelReason.summon | duelReason.specialSummon | duelReason.fusion,
        reasonCardUid: polymerization!.uid,
        reasonEffectId: 1,
      },
    ]);
    expect(restored.host.messages).not.toContain("cyber end responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("cyber end responder resolved") end)
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
