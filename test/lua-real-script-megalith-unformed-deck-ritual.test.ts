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
const setMegalith = 0x138;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Megalith Unformed Deck Ritual", () => {
  it("restores a Deck Ritual Summon in face-up Defense Position", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const unformedCode = "69003792";
    const deckRitualCode = "6901";
    const handRitualDecoyCode = "6902";
    const materialCode = "6903";
    const lowMaterialDecoyCode = "6904";
    const responderCode = "6905";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === unformedCode),
      { code: deckRitualCode, name: "Megalith Unformed Deck Ritual Fixture", kind: "monster", typeFlags: 0x81, level: 4, attack: 2000, defense: 2000, setcodes: [setMegalith] },
      { code: handRitualDecoyCode, name: "Megalith Unformed Hand Ritual Decoy", kind: "monster", typeFlags: 0x81, level: 4, attack: 2000, defense: 2000, setcodes: [setMegalith] },
      { code: materialCode, name: "Megalith Unformed Level 8 Material", kind: "monster", typeFlags: 0x1, level: 8, attack: 2400, defense: 1000 },
      { code: lowMaterialDecoyCode, name: "Megalith Unformed Level 3 Decoy", kind: "monster", typeFlags: 0x1, level: 3, attack: 1400, defense: 1000 },
      { code: responderCode, name: "Megalith Unformed Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 690, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [unformedCode, deckRitualCode, handRitualDecoyCode, materialCode, lowMaterialDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const unformed = session.state.cards.find((card) => card.code === unformedCode);
    const deckRitual = session.state.cards.find((card) => card.code === deckRitualCode);
    const handRitualDecoy = session.state.cards.find((card) => card.code === handRitualDecoyCode);
    const material = session.state.cards.find((card) => card.code === materialCode);
    const lowMaterialDecoy = session.state.cards.find((card) => card.code === lowMaterialDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(unformed).toBeDefined();
    expect(deckRitual).toBeDefined();
    expect(handRitualDecoy).toBeDefined();
    expect(material).toBeDefined();
    expect(lowMaterialDecoy).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, unformed!.uid, "hand", 0);
    moveDuelCard(session.state, handRitualDecoy!.uid, "hand", 0);
    moveDuelCard(session.state, material!.uid, "hand", 0);
    moveDuelCard(session.state, lowMaterialDecoy!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(unformedCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === unformed!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: unformed!.uid,
      operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === deckRitual!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpDefense",
      faceUp: true,
      summonType: "ritual",
      summonMaterialUids: [material!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === handRitualDecoy!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === lowMaterialDecoy!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === unformed!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.host.messages).not.toContain("megalith unformed responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("megalith unformed responder resolved") end)
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
