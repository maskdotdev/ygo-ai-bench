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
const setMagikey = 0x167;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Magikey Maftea Deck Ritual", () => {
  it("restores non-sentinel SelectOption into Ritual extra material extraop", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mafteaCode = "99426088";
    const ritualOptionDescription = Number(mafteaCode) * 16 + 1;
    const ritualTargetCode = "99426080";
    const handMaterialCode = "99426081";
    const deckNormalMaterialCode = "99426082";
    const faceupNormalCode = "99426083";
    const responderCode = "99426084";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mafteaCode),
      { code: ritualTargetCode, name: "Magikey Maftea Ritual Fixture", kind: "monster", typeFlags: 0x81, level: 8, attack: 2500, defense: 2000, setcodes: [setMagikey] },
      { code: handMaterialCode, name: "Magikey Maftea Hand Material Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1200 },
      { code: deckNormalMaterialCode, name: "Magikey Maftea Deck Normal Fixture", kind: "monster", typeFlags: 0x11, level: 4, attack: 1600, defense: 1300 },
      { code: faceupNormalCode, name: "Magikey Maftea Face-up Normal Fixture", kind: "monster", typeFlags: 0x11, level: 1, attack: 1700, defense: 1400 },
      { code: responderCode, name: "Magikey Maftea Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 994, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mafteaCode, ritualTargetCode, handMaterialCode, deckNormalMaterialCode, faceupNormalCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const maftea = session.state.cards.find((card) => card.code === mafteaCode);
    const ritualTarget = session.state.cards.find((card) => card.code === ritualTargetCode);
    const handMaterial = session.state.cards.find((card) => card.code === handMaterialCode);
    const deckNormalMaterial = session.state.cards.find((card) => card.code === deckNormalMaterialCode);
    const faceupNormal = session.state.cards.find((card) => card.code === faceupNormalCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(maftea).toBeDefined();
    expect(ritualTarget).toBeDefined();
    expect(handMaterial).toBeDefined();
    expect(deckNormalMaterial).toBeDefined();
    expect(faceupNormal).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, maftea!.uid, "hand", 0);
    moveDuelCard(session.state, ritualTarget!.uid, "hand", 0);
    moveDuelCard(session.state, handMaterial!.uid, "hand", 0);
    moveDuelCard(session.state, faceupNormal!.uid, "monsterZone", 0);
    faceupNormal!.faceUp = true;
    faceupNormal!.position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(mafteaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === maftea!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "player": 0,
        "sourceUid": "p0-deck-99426088-0",
      }
    `);

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
    expect(restored.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: "SelectOption", player: 0, options: [0], descriptions: [ritualOptionDescription], returned: 0 }),
    ]));

    const summonedRitual = restored.session.state.cards.find((card) => card.uid === ritualTarget!.uid);
    expect(summonedRitual).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "ritual",
    });
    expect(summonedRitual!.summonMaterialUids).toEqual([handMaterial!.uid, faceupNormal!.uid, deckNormalMaterial!.uid]);
    expect(restored.session.state.cards.find((card) => card.uid === handMaterial!.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.material | duelReason.ritual,
    });
    expect(restored.session.state.cards.find((card) => card.uid === faceupNormal!.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.material | duelReason.ritual,
    });
    expect(restored.session.state.cards.find((card) => card.uid === deckNormalMaterial!.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.material | duelReason.ritual,
    });
    expect(restored.session.state.cards.find((card) => card.uid === maftea!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.host.messages).not.toContain("magikey maftea responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("magikey maftea responder resolved") end)
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
