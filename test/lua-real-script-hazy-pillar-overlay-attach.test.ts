import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const setHazyFlame = 0x107d;
const typeMonster = 0x1;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Hazy Pillar overlay attach", () => {
  it("restores Hazy Pillar's targeted Xyz material attachment operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const pillarCode = "83108603";
    const xyzCode = "83108604";
    const hazyMaterialCode = "83108605";
    const offSetMaterialCode = "83108606";
    const responderCode = "83108607";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === pillarCode),
      { code: xyzCode, name: "Hazy Pillar Xyz Holder", kind: "extra", typeFlags: typeMonster | typeXyz, level: 4, attack: 2000, defense: 1600 },
      { code: hazyMaterialCode, name: "Hazy Pillar Hazy Flame Material", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200, setcodes: [setHazyFlame] },
      { code: offSetMaterialCode, name: "Hazy Pillar Off-Set Material", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1700, defense: 1000, setcodes: [0x123] },
      { code: responderCode, name: "Hazy Pillar Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 831, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [pillarCode, hazyMaterialCode, offSetMaterialCode], extra: [xyzCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const pillar = session.state.cards.find((card) => card.code === pillarCode);
    const xyz = session.state.cards.find((card) => card.code === xyzCode);
    const hazyMaterial = session.state.cards.find((card) => card.code === hazyMaterialCode);
    const offSetMaterial = session.state.cards.find((card) => card.code === offSetMaterialCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(pillar).toBeDefined();
    expect(xyz).toBeDefined();
    expect(hazyMaterial).toBeDefined();
    expect(offSetMaterial).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, pillar!.uid, "spellTrapZone", 0);
    pillar!.position = "faceUpAttack";
    pillar!.faceUp = true;
    moveDuelCard(session.state, xyz!.uid, "monsterZone", 0);
    xyz!.position = "faceUpAttack";
    xyz!.faceUp = true;
    moveDuelCard(session.state, hazyMaterial!.uid, "hand", 0);
    moveDuelCard(session.state, offSetMaterial!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(pillarCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const pillarAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === pillar!.uid);
    expect(pillarAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, pillarAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-3",
        "id": "chain-2",
        "player": 0,
        "sourceUid": "p0-deck-83108603-0",
        "targetUids": [
          "p0-extraDeck-83108604-0",
        ],
      }
    `);
    expect(session.state.chain[0]?.operationInfos ?? []).toEqual([]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-3",
        "id": "chain-2",
        "player": 0,
        "sourceUid": "p0-deck-83108603-0",
        "targetUids": [
          "p0-extraDeck-83108604-0",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos ?? []).toEqual([]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === pillar!.uid)).toMatchObject({ location: "spellTrapZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === xyz!.uid)).toMatchObject({ location: "monsterZone", overlayUids: [hazyMaterial!.uid] });
    expect(restored.session.state.cards.find((card) => card.uid === hazyMaterial!.uid)).toMatchObject({
      location: "overlay",
      controller: 0,
      reasonCardUid: pillar!.uid,
      reasonEffectId: 3,
    });
    expect(restored.session.state.cards.find((card) => card.uid === offSetMaterial!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial")).toEqual([]);
    expect(restored.host.messages).not.toContain("hazy pillar responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("hazy pillar responder resolved") end)
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
