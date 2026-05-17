import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const cardAlbaz = "68468459";
const setSpringans = 0x158;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Springans Blast repeated field-zone prompt", () => {
  it("restores repeated SelectFieldZone prompts with the first selected zone filtered out", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const blastCode = "10584050";
    const springansFusionCode = "10584052";
    const responderCode = "10584051";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === blastCode),
      {
        code: springansFusionCode,
        name: "Springans Blast Albaz Fusion Fixture",
        kind: "extra",
        typeFlags: typeMonster | typeEffect | typeFusion,
        setcodes: [setSpringans],
        fusionMaterials: [cardAlbaz],
        level: 8,
        attack: 2500,
        defense: 2000,
      },
      { code: responderCode, name: "Springans Blast Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1058, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [blastCode], extra: [springansFusionCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const blast = requireCard(session, blastCode);
    const springansFusion = requireCard(session, springansFusionCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, blast.uid, "spellTrapZone", 0);
    blast.faceUp = false;
    moveDuelCard(session.state, springansFusion.uid, "monsterZone", 0).position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(blastCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredActivation, 0)).toEqual(getGroupedDuelLegalActions(restoredActivation.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredActivation, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredActivation, 0));

    const activate = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === blast.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restoredActivation, activate!);
    expect(activated.ok, activated.error).toBe(true);
    expect(restoredActivation.host.promptDecisions).toEqual([
      expect.objectContaining({
        api: "SelectFieldZone",
        player: 0,
        options: [1 << 16, 2 << 16, 4 << 16, 8 << 16, 16 << 16],
        returned: 1 << 16,
      }),
      expect.objectContaining({ api: "SelectYesNo", player: 0, returned: true }),
      expect.objectContaining({
        api: "SelectFieldZone",
        player: 0,
        options: [2 << 16, 4 << 16, 8 << 16, 16 << 16],
        returned: 2 << 16,
      }),
    ]);
    expect(restoredActivation.session.state.chain).toHaveLength(1);
    expect(restoredActivation.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "effectLabel": 0,
        "effectLabels": [
          0,
          1,
        ],
        "id": "chain-2",
        "player": 0,
        "sourceUid": "p0-deck-10584050-0",
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    const disabledFieldEffects = restored.session.state.effects.filter((effect) => effect.code === 260 && [1 << 16, 2 << 16].includes(effect.value as number));
    expect(disabledFieldEffects.map((effect) => effect.value)).toEqual([1 << 16, 2 << 16]);
    expect(restored.host.messages).not.toContain("springans blast responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
      e:SetOperation(function(e,tp) Debug.Message("springans blast responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
