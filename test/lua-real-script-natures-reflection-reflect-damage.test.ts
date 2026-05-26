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
const naturesReflectionCode = "83467607";
const tremendousFireCode = "46918794";
const hasNaturesReflectionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${naturesReflectionCode}.lua`));
const hasTremendousFireScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${tremendousFireCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasNaturesReflectionScript || !hasTremendousFireScript)("Lua real script Nature's Reflection reflect damage", () => {
  it("restores Nature's Reflection and reflects real effect damage after snapshot restore", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const starterCode = "83467";
    const reflectionScript = workspace.readScript(`c${naturesReflectionCode}.lua`);
    expect(reflectionScript).toContain("e1:SetCode(EFFECT_REFLECT_DAMAGE)");
    expect(reflectionScript).toContain("e1:SetTargetRange(1,0)");
    expect(reflectionScript).toContain("return re and not re:IsHasType(EFFECT_TYPE_CONTINUOUS) and rp==1-e:GetOwnerPlayer()");
    const fireScript = workspace.readScript(`c${tremendousFireCode}.lua`);
    expect(fireScript).toContain("Duel.Damage(1-tp,1000,REASON_EFFECT,true)");
    expect(fireScript).toContain("Duel.Damage(tp,500,REASON_EFFECT,true)");
    const cards: DuelCardData[] = [
      { code: naturesReflectionCode, name: "Nature's Reflection", kind: "trap", typeFlags: typeTrap },
      { code: tremendousFireCode, name: "Tremendous Fire", kind: "spell", typeFlags: typeSpell },
      { code: starterCode, name: "Nature Reflection Chain Starter", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 83467, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterCode, tremendousFireCode] }, 1: { main: [naturesReflectionCode] } });
    startDuel(session);

    const starter = session.state.cards.find((card) => card.code === starterCode);
    const tremendousFire = session.state.cards.find((card) => card.code === tremendousFireCode);
    const naturesReflection = session.state.cards.find((card) => card.code === naturesReflectionCode);
    expect(starter).toBeDefined();
    expect(tremendousFire).toBeDefined();
    expect(naturesReflection).toBeDefined();
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, tremendousFire!.uid, "hand", 0);
    moveDuelCard(session.state, naturesReflection!.uid, "spellTrapZone", 1);
    naturesReflection!.position = "faceDown";
    naturesReflection!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return chainStarterScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(naturesReflectionCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(tremendousFireCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);

    const reflectionAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === naturesReflection!.uid);
    expect(reflectionAction).toBeDefined();
    applyAndAssert(session, reflectionAction!);
    expect(session.state.chain).toHaveLength(2);

    const reflectionRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(reflectionRestored.restoreComplete, reflectionRestored.incompleteReasons.join("; ")).toBe(true);
    expect(reflectionRestored.missingRegistryKeys).toEqual([]);
    expect(reflectionRestored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(reflectionRestored, 0)).toEqual(getGroupedDuelLegalActions(reflectionRestored.session, 0));
    expect(getLuaRestoreLegalActionGroups(reflectionRestored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(reflectionRestored, 0));

    const reflectionPass = getLuaRestoreLegalActions(reflectionRestored, 0).find((action) => action.type === "passChain");
    expect(reflectionPass).toBeDefined();
    expect(applyLuaRestoreResponse(reflectionRestored, reflectionPass!).ok).toBe(true);
    expect(reflectionRestored.host.messages).toContain("nature reflection starter resolved");
    expect(reflectionRestored.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 83 && effect.sourceUid === naturesReflection!.uid)).toMatchInlineSnapshot(`
      {
        "battleDamageValue": [Function],
        "canActivate": [Function],
        "code": 83,
        "controller": 1,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-4-83",
        "lifePointValue": [Function],
        "luaTypeFlags": 2,
        "luaValueDescriptor": "reflect-damage:opponent-non-continuous",
        "oncePerTurn": false,
        "operation": [Function],
        "ownerPlayer": 1,
        "promptOperation": [Function],
        "property": 2048,
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
        "registryKey": "lua:83467607:lua-4-83",
        "reset": {
          "flags": 1073742336,
        },
        "sourceUid": "p1-deck-83467607-0",
        "statValue": [Function],
        "target": [Function],
        "targetRange": [
          1,
          0,
        ],
        "valueCardPredicate": [Function],
        "valuePredicate": [Function],
      }
    `);
    expect(serializeDuel(reflectionRestored.session).state.effects.find((effect) => effect.code === 83 && effect.sourceUid === naturesReflection!.uid)).toMatchInlineSnapshot(`
      {
        "code": 83,
        "controller": 1,
        "event": "continuous",
        "id": "lua-4-83",
        "luaTypeFlags": 2,
        "luaValueDescriptor": "reflect-damage:opponent-non-continuous",
        "oncePerTurn": false,
        "ownerPlayer": 1,
        "property": 2048,
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
        "registryKey": "lua:83467607:lua-4-83",
        "reset": {
          "flags": 1073742336,
        },
        "sourceUid": "p1-deck-83467607-0",
        "targetRange": [
          1,
          0,
        ],
      }
    `);

    const fireAction = getLegalActions(reflectionRestored.session, 0).find((action) => action.type === "activateEffect" && action.uid === tremendousFire!.uid);
    expect(fireAction).toBeDefined();
    applyAndAssert(reflectionRestored.session, fireAction!);
    expect(reflectionRestored.session.state.chain).toHaveLength(1);

    const fireRestored = restoreDuelWithLuaScripts(serializeDuel(reflectionRestored.session), source, reader);
    expect(fireRestored.restoreComplete, fireRestored.incompleteReasons.join("; ")).toBe(true);
    expect(fireRestored.missingRegistryKeys).toEqual([]);
    expect(fireRestored.missingChainLimitRegistryKeys).toEqual([]);
    const fireResponsePlayer = fireRestored.session.state.waitingFor!;
    expect(getLuaRestoreLegalActionGroups(fireRestored, fireResponsePlayer)).toEqual(getGroupedDuelLegalActions(fireRestored.session, fireResponsePlayer));
    expect(getLuaRestoreLegalActionGroups(fireRestored, fireResponsePlayer).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(fireRestored, fireResponsePlayer));
    expect(fireRestored.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 83 && effect.sourceUid === naturesReflection!.uid)).toMatchInlineSnapshot(`
      {
        "code": 83,
        "controller": 1,
        "event": "continuous",
        "id": "lua-4-83",
        "luaTypeFlags": 2,
        "luaValueDescriptor": "reflect-damage:opponent-non-continuous",
        "oncePerTurn": false,
        "operation": [Function],
        "ownerPlayer": 1,
        "property": 2048,
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
        "registryKey": "lua:83467607:lua-4-83",
        "reset": {
          "flags": 1073742336,
        },
        "sourceUid": "p1-deck-83467607-0",
        "targetRange": [
          1,
          0,
        ],
        "valuePredicate": [Function],
      }
    `);

    const firePass = getLuaRestoreLegalActions(fireRestored, fireResponsePlayer).find((action) => action.type === "passChain");
    expect(firePass).toBeDefined();
    const resolved = applyLuaRestoreResponse(fireRestored, firePass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(fireRestored.session.state.players[0].lifePoints).toBe(6500);
    expect(fireRestored.session.state.players[1].lifePoints).toBe(8000);
    expect(fireRestored.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tremendousFire!.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tremendousFire!.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(fireRestored.session.state.cards.find((card) => card.uid === tremendousFire!.uid)).toMatchObject({ location: "graveyard" });
  });
});

function chainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("nature reflection starter resolved") end)
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
