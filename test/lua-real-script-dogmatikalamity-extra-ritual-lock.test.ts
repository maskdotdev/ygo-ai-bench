import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, canSpecialSummonDuelCard, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const setDogmatika = 0x146;
const typeMonster = 0x1;
const typeRitual = 0x80;
const typeFusion = 0x40;
const typePendulum = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dogmatikalamity Extra Deck Ritual lock", () => {
  it("restores a sole Extra Deck Ritual material and the post-resolution Extra Deck summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dogmatikalamityCode = "31002402";
    const ritualTargetCode = "3101";
    const extraMaterialCode = "3102";
    const pendulumExtraCode = "3103";
    const responderCode = "3104";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dogmatikalamityCode),
      { code: ritualTargetCode, name: "Dogmatikalamity Ritual Fixture", kind: "monster", typeFlags: typeMonster | typeRitual, level: 8, attack: 2500, defense: 2500, setcodes: [setDogmatika] },
      { code: extraMaterialCode, name: "Dogmatikalamity Extra Deck Material Fixture", kind: "extra", typeFlags: typeMonster | typeFusion, level: 8, attack: 2400, defense: 2000 },
      { code: pendulumExtraCode, name: "Dogmatikalamity Pendulum Extra Probe", kind: "extra", typeFlags: typeMonster | typePendulum, level: 4, attack: 1200, defense: 1000 },
      { code: responderCode, name: "Dogmatikalamity Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 310, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dogmatikalamityCode, ritualTargetCode], extra: [extraMaterialCode, pendulumExtraCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const dogmatikalamity = session.state.cards.find((card) => card.code === dogmatikalamityCode);
    const ritualTarget = session.state.cards.find((card) => card.code === ritualTargetCode);
    const extraMaterial = session.state.cards.find((card) => card.code === extraMaterialCode);
    const pendulumExtra = session.state.cards.find((card) => card.code === pendulumExtraCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(dogmatikalamity).toBeDefined();
    expect(ritualTarget).toBeDefined();
    expect(extraMaterial).toBeDefined();
    expect(pendulumExtra).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, dogmatikalamity!.uid, "hand", 0);
    moveDuelCard(session.state, ritualTarget!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    pendulumExtra!.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    expect(canSpecialSummonDuelCard(session.state, pendulumExtra!.uid, 0)).toBe(true);

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dogmatikalamityCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === dogmatikalamity!.uid);
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
            "parameter": 2,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-31002402-0",
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
      summonMaterialUids: [extraMaterial!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === extraMaterial!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.effect | duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === pendulumExtra!.uid)).toMatchObject({ location: "extraDeck", faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === dogmatikalamity!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === ritualTarget!.uid)).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-3101-1",
          "eventCode": 1102,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "specialSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventReason": 1050640,
          "eventReasonCardUid": "p0-deck-31002402-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
        },
      ]
    `);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === extraMaterial!.uid)).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-extraDeck-3102-0",
          "eventCode": 1014,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventName": "sentToGraveyard",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "extraDeck",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 1048648,
          "eventReasonCardUid": "p0-deck-31002402-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
        },
      ]
    `);
    expect(restored.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 22 && effect.luaTargetDescriptor === "special-summon-limit:extra")).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 22,
        "controller": 0,
        "cost": [Function],
        "description": 496038432,
        "event": "continuous",
        "id": "lua-3-22",
        "luaTargetDescriptor": "special-summon-limit:extra",
        "luaTypeFlags": 2,
        "oncePerTurn": false,
        "operation": [Function],
        "ownerPlayer": 0,
        "promptOperation": [Function],
        "property": 67110912,
        "range": [
          "deck",
          "hand",
          "monsterZone",
          "spellTrapZone",
          "graveyard",
          "banished",
          "extraDeck",
          "overlay",
        ],
        "registryKey": "lua:31002402:lua-3-22",
        "reset": {
          "flags": 1073742336,
        },
        "sourceUid": "p0-deck-31002402-0",
        "target": [Function],
        "targetCardPredicate": [Function],
        "targetRange": [
          1,
          0,
        ],
      }
    `);
    expect(canSpecialSummonDuelCard(restored.session.state, pendulumExtra!.uid, 0)).toBe(false);

    applyAndAssert(restored.session, getLegalActions(restored.session, 0).find((action) => action.type === "endTurn")!);
    expect(restored.session.state.turnPlayer).toBe(1);
    expect(canSpecialSummonDuelCard(restored.session.state, pendulumExtra!.uid, 0)).toBe(true);
    expect(restored.host.messages).not.toContain("dogmatikalamity responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("dogmatikalamity responder resolved") end)
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
