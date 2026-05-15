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
const raceReptile = 0x80000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mitsurugi Mirror grave Ritual Summon", () => {
  it("restores a Ritual procedure that summons the Ritual Monster from the Graveyard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mirrorCode = "49721684";
    const ritualTargetCode = "4972";
    const reptileMaterialACode = "4973";
    const warriorMaterialCode = "4974";
    const reptileMaterialBCode = "4975";
    const responderCode = "4976";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mirrorCode),
      { code: ritualTargetCode, name: "Mitsurugi Grave Ritual Fixture", kind: "monster", typeFlags: 0x81, level: 8, race: raceReptile, attack: 2500, defense: 2000 },
      { code: reptileMaterialACode, name: "Mitsurugi Reptile Material A Fixture", kind: "monster", typeFlags: 0x1, level: 4, race: raceReptile, attack: 1200, defense: 1000 },
      { code: warriorMaterialCode, name: "Mitsurugi Warrior Material Fixture", kind: "monster", typeFlags: 0x1, level: 4, race: raceWarrior, attack: 1300, defense: 1000 },
      { code: reptileMaterialBCode, name: "Mitsurugi Reptile Material B Fixture", kind: "monster", typeFlags: 0x1, level: 4, race: raceReptile, attack: 1400, defense: 1000 },
      { code: responderCode, name: "Mitsurugi Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 497, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mirrorCode, ritualTargetCode, reptileMaterialACode, warriorMaterialCode, reptileMaterialBCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const mirror = session.state.cards.find((card) => card.code === mirrorCode);
    const ritualTarget = session.state.cards.find((card) => card.code === ritualTargetCode);
    const reptileMaterialA = session.state.cards.find((card) => card.code === reptileMaterialACode);
    const warriorMaterial = session.state.cards.find((card) => card.code === warriorMaterialCode);
    const reptileMaterialB = session.state.cards.find((card) => card.code === reptileMaterialBCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(mirror).toBeDefined();
    expect(ritualTarget).toBeDefined();
    expect(reptileMaterialA).toBeDefined();
    expect(warriorMaterial).toBeDefined();
    expect(reptileMaterialB).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, mirror!.uid, "hand", 0);
    moveDuelCard(session.state, ritualTarget!.uid, "graveyard", 0);
    moveDuelCard(session.state, reptileMaterialA!.uid, "hand", 0);
    moveDuelCard(session.state, warriorMaterial!.uid, "hand", 0);
    moveDuelCard(session.state, reptileMaterialB!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(mirrorCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === mirror!.uid);
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
        "operationInfos": [
          {
            "category": 512,
            "count": 1,
            "parameter": 18,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-49721684-0",
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

    expect(restored.session.state.cards.find((card) => card.uid === ritualTarget!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "ritual",
      summonMaterialUids: [reptileMaterialA!.uid, reptileMaterialB!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === reptileMaterialA!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === warriorMaterial!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === reptileMaterialB!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === mirror!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.host.messages).not.toContain("mitsurugi responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("mitsurugi responder resolved") end)
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
