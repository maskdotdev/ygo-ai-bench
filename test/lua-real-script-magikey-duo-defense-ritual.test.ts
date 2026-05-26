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
const magikeyDuoCode = "51510279";
const hasMagikeyDuoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${magikeyDuoCode}.lua`));
const setMagikey = 0x167;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeNormal = 0x10;
const typeRitual = 0x80;

describe.skipIf(!hasUpstreamScripts || !hasMagikeyDuoScript)("Lua real script Magikey Duo defense Ritual", () => {
  it("restores a target-returning Ritual.Operation branch with sumpos face-up Defense", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const returnOptionDescription = Number(magikeyDuoCode) * 16 + 1;
    const ritualOptionDescription = Number(magikeyDuoCode) * 16 + 3;
    const ritualTargetCode = "51510270";
    const graveTargetCode = "51510271";
    const materialCode = "51510272";
    const responderCode = "51510273";
    const script = workspace.readScript(`c${magikeyDuoCode}.lua`);
    expect(script).toContain("sumpos=POS_FACEUP_DEFENSE");
    expect(script).toContain("local res=Duel.SelectOption(tp,false,table.unpack(sel))");
    expect(script).toContain("Ritual.Operation(rparams)");
    const cards: DuelCardData[] = [
      { code: magikeyDuoCode, name: "Magikey Duo", kind: "spell", typeFlags: typeSpell },
      { code: ritualTargetCode, name: "Magikey Duo Ritual Target Fixture", kind: "monster", typeFlags: typeMonster | typeRitual, level: 4, attack: 1900, defense: 1600, setcodes: [setMagikey] },
      { code: graveTargetCode, name: "Magikey Duo Graveyard Target Fixture", kind: "monster", typeFlags: typeMonster | typeNormal, level: 4, attack: 1500, defense: 1200 },
      { code: materialCode, name: "Magikey Duo Ritual Material Fixture", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
      { code: responderCode, name: "Magikey Duo Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 515, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [magikeyDuoCode, ritualTargetCode, graveTargetCode, materialCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const magikeyDuo = session.state.cards.find((card) => card.code === magikeyDuoCode);
    const ritualTarget = session.state.cards.find((card) => card.code === ritualTargetCode);
    const graveTarget = session.state.cards.find((card) => card.code === graveTargetCode);
    const material = session.state.cards.find((card) => card.code === materialCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(magikeyDuo).toBeDefined();
    expect(ritualTarget).toBeDefined();
    expect(graveTarget).toBeDefined();
    expect(material).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, magikeyDuo!.uid, "spellTrapZone", 0);
    magikeyDuo!.faceUp = false;
    moveDuelCard(session.state, ritualTarget!.uid, "hand", 0);
    moveDuelCard(session.state, material!.uid, "hand", 0);
    moveDuelCard(session.state, graveTarget!.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(magikeyDuoCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === magikeyDuo!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 8,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-51510271-2",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-51510279-0",
        "targetFieldIds": [
          9,
        ],
        "targetUids": [
          "p0-deck-51510271-2",
        ],
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 8,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-51510271-2",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-51510279-0",
        "targetFieldIds": [
          9,
        ],
        "targetUids": [
          "p0-deck-51510271-2",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x8, targetUids: [graveTarget!.uid], count: 1, player: 0, parameter: 0 }]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: "SelectOption", player: 0, options: [1, 2], descriptions: [returnOptionDescription, ritualOptionDescription], returned: 1 }),
    ]));

    expect(restored.session.state.cards.find((card) => card.uid === ritualTarget!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpDefense",
      faceUp: true,
      summonType: "ritual",
      summonMaterialUids: [material!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === graveTarget!.uid)).toMatchObject({ location: "hand", controller: 0, reason: duelReason.effect });
    expect(restored.session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.material | duelReason.ritual,
    });
    expect(restored.session.state.cards.find((card) => card.uid === magikeyDuo!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === ritualTarget!.uid)).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-51510270-1",
          "eventCode": 1102,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpDefense",
            "sequence": 0,
          },
          "eventName": "specialSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 1050640,
          "eventReasonCardUid": "p0-deck-51510279-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
        },
      ]
    `);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToHand" && event.eventCardUid === graveTarget!.uid)).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-51510271-2",
          "eventCode": 1012,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 2,
          },
          "eventName": "sentToHand",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 64,
          "eventReasonCardUid": "p0-deck-51510279-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
        },
      ]
    `);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === material!.uid)).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-51510272-3",
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
            "location": "hand",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventReason": 1048584,
          "eventReasonCardUid": "p0-deck-51510279-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
        },
      ]
    `);
    expect(restored.host.messages).not.toContain("magikey duo responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("magikey duo responder resolved") end)
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
