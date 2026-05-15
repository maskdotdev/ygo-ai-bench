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
const setBlackLusterSoldier = 0x10cf;
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Super Soldier Synthesis specific Ritual materials", () => {
  it("restores specificmatfilter hand-plus-Deck Ritual material pruning", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const synthesisCode = "45948430";
    const ritualTargetCode = "45941";
    const handLightMaterialCode = "45942";
    const handDarkDecoyCode = "45943";
    const deckDarkMaterialCode = "45944";
    const responderCode = "45945";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === synthesisCode),
      { code: ritualTargetCode, name: "Super Soldier Synthesis Ritual Fixture", kind: "monster", typeFlags: 0x81, level: 8, attack: 3000, defense: 2500, attribute: attributeDark, setcodes: [setBlackLusterSoldier] },
      { code: handLightMaterialCode, name: "Super Soldier Synthesis Light Hand Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1200, attribute: attributeLight },
      { code: handDarkDecoyCode, name: "Super Soldier Synthesis Dark Hand Decoy Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1200, attribute: attributeDark },
      { code: deckDarkMaterialCode, name: "Super Soldier Synthesis Dark Deck Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1300, attribute: attributeDark },
      { code: responderCode, name: "Super Soldier Synthesis Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 459, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [synthesisCode, ritualTargetCode, handLightMaterialCode, handDarkDecoyCode, deckDarkMaterialCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const synthesis = session.state.cards.find((card) => card.code === synthesisCode);
    const ritualTarget = session.state.cards.find((card) => card.code === ritualTargetCode);
    const handLightMaterial = session.state.cards.find((card) => card.code === handLightMaterialCode);
    const handDarkDecoy = session.state.cards.find((card) => card.code === handDarkDecoyCode);
    const deckDarkMaterial = session.state.cards.find((card) => card.code === deckDarkMaterialCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(synthesis).toBeDefined();
    expect(ritualTarget).toBeDefined();
    expect(handLightMaterial).toBeDefined();
    expect(handDarkDecoy).toBeDefined();
    expect(deckDarkMaterial).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, synthesis!.uid, "hand", 0);
    moveDuelCard(session.state, ritualTarget!.uid, "hand", 0);
    moveDuelCard(session.state, handLightMaterial!.uid, "hand", 0);
    moveDuelCard(session.state, handDarkDecoy!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(synthesisCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === synthesis!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: synthesis!.uid,
    });
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x20, targetUids: [], count: 1, player: 0, parameter: 0x3 },
      { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x12 },
    ]);

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
    expect(summonedRitual!.summonMaterialUids).toEqual([handLightMaterial!.uid, deckDarkMaterial!.uid]);
    expect(restored.session.state.cards.find((card) => card.uid === handLightMaterial!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.effect | duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === deckDarkMaterial!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.effect | duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === handDarkDecoy!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === synthesis!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.host.messages).not.toContain("super soldier synthesis responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("super soldier synthesis responder resolved") end)
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
