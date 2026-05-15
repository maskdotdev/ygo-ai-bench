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
const setVendread = 0x106;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Vendread Reunion custom Ritual operation", () => {
  it("restores a custom Ritual operation that sets, releases, and Ritual Summons with banished materials", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const reunionCode = "2266498";
    const ritualTargetCode = "2266";
    const materialACode = "2267";
    const materialBCode = "2268";
    const responderCode = "2269";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === reunionCode),
      { code: ritualTargetCode, name: "Vendread Reunion Ritual Fixture", kind: "monster", typeFlags: 0x81, level: 8, attack: 2600, defense: 2100, setcodes: [setVendread] },
      { code: materialACode, name: "Vendread Reunion Material A Fixture", kind: "monster", typeFlags: 0x21, level: 4, attack: 1500, defense: 1200, setcodes: [setVendread] },
      { code: materialBCode, name: "Vendread Reunion Material B Fixture", kind: "monster", typeFlags: 0x21, level: 4, attack: 1600, defense: 1300, setcodes: [setVendread] },
      { code: responderCode, name: "Vendread Reunion Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 226, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [reunionCode, ritualTargetCode, materialACode, materialBCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const reunion = session.state.cards.find((card) => card.code === reunionCode);
    const ritualTarget = session.state.cards.find((card) => card.code === ritualTargetCode);
    const materialA = session.state.cards.find((card) => card.code === materialACode);
    const materialB = session.state.cards.find((card) => card.code === materialBCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(reunion).toBeDefined();
    expect(ritualTarget).toBeDefined();
    expect(materialA).toBeDefined();
    expect(materialB).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, reunion!.uid, "spellTrapZone", 0);
    reunion!.position = "faceDown";
    reunion!.faceUp = false;
    moveDuelCard(session.state, ritualTarget!.uid, "hand", 0);
    moveDuelCard(session.state, materialA!.uid, "banished", 0);
    moveDuelCard(session.state, materialB!.uid, "banished", 0);
    materialA!.faceUp = true;
    materialB!.faceUp = true;
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
    expect(host.loadCardScript(Number(reunionCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === reunion!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);

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

    const summonedRitual = restored.session.state.cards.find((card) => card.uid === ritualTarget!.uid);
    expect(summonedRitual).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true, summonType: "ritual" });
    expect(summonedRitual!.summonMaterialUids).toEqual([materialA!.uid, materialB!.uid]);
    expect(restored.session.state.cards.find((card) => card.uid === materialA!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.release | duelReason.effect | duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === materialB!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.release | duelReason.effect | duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === reunion!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.host.messages).toEqual([`confirmed 1: ${ritualTargetCode}`, `confirmed 1: ${materialACode},${materialBCode}`]);
    expect(restored.host.messages).not.toContain("vendread reunion responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("vendread reunion responder resolved") end)
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
