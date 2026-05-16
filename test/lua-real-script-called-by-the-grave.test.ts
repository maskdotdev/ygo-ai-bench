import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Called by the Grave", () => {
  it("banishes a GY monster and negates same-code monster effects while solving", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const calledByCode = "24224830";
    const sameCodeMonster = "10000020";
    const calledBy = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === calledByCode);
    expect(calledBy).toBeDefined();
    const cards: DuelCardData[] = [calledBy!, { code: sameCodeMonster, name: "Same-Code Monster", kind: "monster", typeFlags: 0x21 }];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 294, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [calledByCode, sameCodeMonster] }, 1: { main: [sameCodeMonster] } });
    startDuel(session);

    const calledByCard = session.state.cards.find((card) => card.code === calledByCode);
    const activeMonster = session.state.cards.find((card) => card.code === sameCodeMonster && card.controller === 0);
    const graveyardMonster = session.state.cards.find((card) => card.code === sameCodeMonster && card.controller === 1);
    expect(calledByCard).toBeDefined();
    expect(activeMonster).toBeDefined();
    expect(graveyardMonster).toBeDefined();
    moveDuelCard(session.state, calledByCard!.uid, "hand", 0);
    moveDuelCard(session.state, activeMonster!.uid, "hand", 0);
    moveDuelCard(session.state, graveyardMonster!.uid, "graveyard", 1);

    const source = {
      readScript(name: string) {
        return name === `c${sameCodeMonster}.lua` ? sameCodeMonsterScript(sameCodeMonster) : workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(calledByCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(sameCodeMonster), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(session.state.effects.find((effect) => effect.sourceUid === activeMonster!.uid)).toMatchObject({
      description: Number(sameCodeMonster),
    });

    const calledByAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === calledByCard!.uid);
    expect(calledByAction).toBeDefined();
    const calledByResolved = applyResponse(session, calledByAction!);
    expect(calledByResolved.ok, calledByResolved.error).toBe(true);
    expect(session.state.chain).toHaveLength(0);
    expect(session.state.cards.find((card) => card.uid === graveyardMonster!.uid)).toMatchObject({ location: "banished" });
    expect(session.state.cards.find((card) => card.uid === calledByCard!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.effects.filter((effect) => effect.sourceUid === calledByCard!.uid && [2, 1020].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 2,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-4-2",
          "label": 10000020,
          "luaTypeFlags": 2,
          "oncePerTurn": false,
          "operation": [Function],
          "ownerPlayer": 0,
          "promptOperation": [Function],
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
          "registryKey": "lua:24224830:lua-4-2",
          "reset": {
            "count": 2,
            "flags": 1073742336,
          },
          "sourceUid": "p0-deck-24224830-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "targetRange": [
            4,
            4,
          ],
        },
        {
          "canActivate": [Function],
          "code": 1020,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-5-1020",
          "label": 10000020,
          "luaConditionDescriptor": "condition:chain-solving-monster-effect-handler-original-code-label",
          "luaTypeFlags": 2050,
          "oncePerTurn": false,
          "operation": [Function],
          "ownerPlayer": 0,
          "promptOperation": [Function],
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
          "registryKey": "lua:24224830:lua-5-1020",
          "reset": {
            "count": 2,
            "flags": 1073742336,
          },
          "sourceUid": "p0-deck-24224830-0",
          "target": [Function],
          "triggerCode": 1020,
          "triggerEvent": "chainSolving",
          "triggerTiming": "when",
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.cards.find((card) => card.uid === graveyardMonster!.uid)).toMatchObject({ location: "banished" });
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === activeMonster!.uid)).toMatchObject({
      description: Number(sameCodeMonster),
    });
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === calledByCard!.uid && [2, 1020].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "code": 2,
          "controller": 0,
          "event": "continuous",
          "id": "lua-4-2",
          "label": 10000020,
          "oncePerTurn": false,
          "operation": [Function],
          "ownerPlayer": 0,
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
          "registryKey": "lua:24224830:lua-4-2",
          "reset": {
            "count": 2,
            "flags": 1073742336,
          },
          "sourceUid": "p0-deck-24224830-0",
          "targetRange": [
            4,
            4,
          ],
        },
        {
          "canActivate": [Function],
          "code": 1020,
          "controller": 0,
          "event": "continuous",
          "id": "lua-5-1020",
          "label": 10000020,
          "luaConditionDescriptor": "condition:chain-solving-monster-effect-handler-original-code-label",
          "oncePerTurn": false,
          "operation": [Function],
          "ownerPlayer": 0,
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
          "registryKey": "lua:24224830:lua-5-1020",
          "reset": {
            "count": 2,
            "flags": 1073742336,
          },
          "sourceUid": "p0-deck-24224830-0",
          "triggerCode": 1020,
          "triggerEvent": "chainSolving",
          "triggerTiming": "when",
        },
      ]
    `);
    const restoredSameCodeAction = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === activeMonster!.uid);
    expect(restoredSameCodeAction).toBeDefined();
    const restoredSameCodeResolved = applyLuaRestoreResponse(restored, restoredSameCodeAction!);
    expect(restoredSameCodeResolved.ok, restoredSameCodeResolved.error).toBe(true);
    expect(restored.session.state.chain).toHaveLength(0);
    expect(restored.host.messages).not.toContain("same-code monster resolved");
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "chainDisabled")).toEqual([
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
        relatedEffectId: 2,
      },
    ]);

    const sameCodeAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === activeMonster!.uid);
    expect(sameCodeAction).toBeDefined();
    const sameCodeResolved = applyResponse(session, sameCodeAction!);
    expect(sameCodeResolved.ok, sameCodeResolved.error).toBe(true);
    expect(session.state.chain).toHaveLength(0);
    expect(host.messages).not.toContain("same-code monster resolved");
    expect(session.state.eventHistory.filter((event) => event.eventName === "chainDisabled")).toEqual([
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
        relatedEffectId: 2,
      },
    ]);
  });
});

function sameCodeMonsterScript(code: string): string {
  return `
  local s,id=GetID()
  function s.initial_effect(c)
    local e=Effect.CreateEffect(c)
    e:SetDescription(${Number(code)})
    e:SetType(EFFECT_TYPE_IGNITION)
    e:SetRange(LOCATION_HAND)
    e:SetOperation(function(e,tp)
      Debug.Message("same-code monster resolved")
    end)
    c:RegisterEffect(e)
  end
  `;
}
