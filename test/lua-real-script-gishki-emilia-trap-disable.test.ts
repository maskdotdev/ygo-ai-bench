import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const setGishki = 0x3a;
const typeMonster = 0x1;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gishki Emilia Trap disable", () => {
  it("restores its summon-triggered Trap disable and suppresses activated Trap effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const emiliaCode = "73551138";
    const gishkiAllyCode = "73551139";
    const trapCode = "73551140";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === emiliaCode),
      { code: gishkiAllyCode, name: "Gishki Emilia Ally", kind: "monster", typeFlags: typeMonster, setcodes: [setGishki], level: 4, attack: 1400, defense: 1200 },
      { code: trapCode, name: "Gishki Emilia Disabled Trap", kind: "trap", typeFlags: typeTrap },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 735, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [emiliaCode, gishkiAllyCode, trapCode] }, 1: { main: [] } });
    startDuel(session);

    const emilia = session.state.cards.find((card) => card.code === emiliaCode);
    const gishkiAlly = session.state.cards.find((card) => card.code === gishkiAllyCode);
    const trap = session.state.cards.find((card) => card.code === trapCode);
    expect(emilia).toBeDefined();
    expect(gishkiAlly).toBeDefined();
    expect(trap).toBeDefined();
    moveDuelCard(session.state, emilia!.uid, "hand", 0);
    moveDuelCard(session.state, gishkiAlly!.uid, "monsterZone", 0);
    gishkiAlly!.position = "faceUpAttack";
    gishkiAlly!.faceUp = true;
    moveDuelCard(session.state, trap!.uid, "spellTrapZone", 0);
    trap!.position = "faceDown";
    trap!.faceUp = false;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${trapCode}.lua`) return disabledTrapScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(emiliaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(trapCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === emilia!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-7-1100",
          "eventCardUid": "p0-deck-73551138-0",
          "eventCode": 1100,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventName": "normalSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 16,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "id": "trigger-5-1",
          "player": 0,
          "sourceUid": "p0-deck-73551138-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === emilia!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toMatchInlineSnapshot(`
      [
        {
          "activationLocation": "monsterZone",
          "activationSequence": 1,
          "chainIndex": 1,
          "effectId": "lua-7-1100",
          "eventCardUid": "p0-deck-73551138-0",
          "eventCode": 1100,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventName": "normalSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 16,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "id": "chain-5",
          "player": 0,
          "sourceUid": "p0-deck-73551138-0",
        },
      ]
    `);

    const restoredDisableChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredDisableChain.restoreComplete, restoredDisableChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDisableChain.missingRegistryKeys).toEqual([]);
    expect(restoredDisableChain.missingChainLimitRegistryKeys).toEqual([]);
    const disableResponsePlayer = restoredDisableChain.session.state.waitingFor ?? 0;
    expectRestoredLegalActions(restoredDisableChain, disableResponsePlayer);
    const passDisable = getLuaRestoreLegalActions(restoredDisableChain, disableResponsePlayer).find((action) => action.type === "passChain");
    expect(passDisable, JSON.stringify(getLuaRestoreLegalActions(restoredDisableChain, disableResponsePlayer), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDisableChain, passDisable!);
    expect(restoredDisableChain.session.state.chain).toEqual([]);
    expect(restoredDisableChain.session.state.cards.find((card) => card.uid === emilia!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredDisableChain.session.state.effects.filter((effect) => effect.sourceUid === emilia!.uid && [2, 25, 1020].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 2,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-14-2",
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
          "registryKey": "lua:73551138:lua-14-2",
          "reset": {
            "flags": 1073742336,
          },
          "sourceUid": "p0-deck-73551138-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "targetRange": [
            8,
            8,
          ],
        },
        {
          "canActivate": [Function],
          "code": 1020,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-15-1020",
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
          "registryKey": "lua:73551138:lua-15-1020",
          "reset": {
            "flags": 1073742336,
          },
          "sourceUid": "p0-deck-73551138-0",
          "target": [Function],
          "triggerCode": 1020,
          "triggerEvent": "chainSolving",
        },
      ]
    `);

    const restoredTrapWindow = restoreDuelWithLuaScripts(serializeDuel(restoredDisableChain.session), source, reader);
    expect(restoredTrapWindow.restoreComplete, restoredTrapWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrapWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTrapWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTrapWindow, 0);
    const disabledProbe = restoredTrapWindow.host.loadScript(
      `
      local trap=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode, ${trapCode}),0,LOCATION_SZONE,0,nil)
      Debug.Message("gishki emilia trap disabled " .. tostring(trap:IsDisabled()))
      `,
      "gishki-emilia-trap-disable-probe.lua",
    );
    expect(disabledProbe.ok, disabledProbe.error).toBe(true);
    expect(restoredTrapWindow.host.messages).toContain("gishki emilia trap disabled true");
    const trapAction = getLuaRestoreLegalActions(restoredTrapWindow, 0).find((action) => action.type === "activateEffect" && action.uid === trap!.uid);
    expect(trapAction, JSON.stringify(getLuaRestoreLegalActions(restoredTrapWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrapWindow, trapAction!);
    expect(restoredTrapWindow.session.state.chain).toMatchInlineSnapshot(`[]`);

    const restoredTrapChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrapWindow.session), source, reader);
    expect(restoredTrapChain.restoreComplete, restoredTrapChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrapChain.missingRegistryKeys).toEqual([]);
    expect(restoredTrapChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTrapChain, 0);
    expect(restoredTrapChain.host.messages).not.toContain("gishki emilia disabled trap resolved");
    expect(restoredTrapChain.session.state.cards.find((card) => card.uid === trap!.uid)).toMatchObject({ location: "graveyard", previousLocation: "spellTrapZone" });
    expect(restoredTrapChain.session.state.eventHistory.filter((event) => event.eventName === "chainDisabled")).toEqual([
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-7",
        relatedEffectId: 12,
      },
    ]);
  });
});

function disabledTrapScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp)
        Debug.Message("gishki emilia disabled trap resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
