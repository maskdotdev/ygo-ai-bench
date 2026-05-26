import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { ChainLink, DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dark Dust Spirit group destroy", () => {
  it("restores its Spirit summon trigger and destroys all other face-up monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const darkDustCode = "89111398";
    const tributeCode = "89111399";
    const ownFaceupCode = "89111400";
    const opponentAttackCode = "89111401";
    const opponentDefenseCode = "89111402";
    const opponentFaceDownCode = "89111403";
    const responderCode = "89111404";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === darkDustCode),
      { code: tributeCode, name: "Dark Dust Tribute", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: ownFaceupCode, name: "Dark Dust Own Face-Up", kind: "monster", typeFlags: 0x1, level: 4, attack: 1300, defense: 1400 },
      { code: opponentAttackCode, name: "Dark Dust Opponent Attack", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1200 },
      { code: opponentDefenseCode, name: "Dark Dust Opponent Defense", kind: "monster", typeFlags: 0x1, level: 4, attack: 900, defense: 1900 },
      { code: opponentFaceDownCode, name: "Dark Dust Opponent Set", kind: "monster", typeFlags: 0x1, level: 4, attack: 800, defense: 2000 },
      { code: responderCode, name: "Dark Dust Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 891, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [darkDustCode, tributeCode, ownFaceupCode] },
      1: { main: [opponentAttackCode, opponentDefenseCode, opponentFaceDownCode, responderCode] },
    });
    startDuel(session);

    const darkDust = session.state.cards.find((card) => card.code === darkDustCode);
    const tribute = session.state.cards.find((card) => card.code === tributeCode);
    const ownFaceup = session.state.cards.find((card) => card.code === ownFaceupCode);
    const opponentAttack = session.state.cards.find((card) => card.code === opponentAttackCode);
    const opponentDefense = session.state.cards.find((card) => card.code === opponentDefenseCode);
    const opponentFaceDown = session.state.cards.find((card) => card.code === opponentFaceDownCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(darkDust).toBeDefined();
    expect(tribute).toBeDefined();
    expect(ownFaceup).toBeDefined();
    expect(opponentAttack).toBeDefined();
    expect(opponentDefense).toBeDefined();
    expect(opponentFaceDown).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, darkDust!.uid, "hand", 0);
    moveDuelCard(session.state, tribute!.uid, "monsterZone", 0);
    tribute!.position = "faceUpAttack";
    tribute!.faceUp = true;
    moveDuelCard(session.state, ownFaceup!.uid, "monsterZone", 0);
    ownFaceup!.position = "faceUpDefense";
    ownFaceup!.faceUp = true;
    moveDuelCard(session.state, opponentAttack!.uid, "monsterZone", 1);
    opponentAttack!.position = "faceUpAttack";
    opponentAttack!.faceUp = true;
    moveDuelCard(session.state, opponentDefense!.uid, "monsterZone", 1);
    opponentDefense!.position = "faceUpDefense";
    opponentDefense!.faceUp = true;
    moveDuelCard(session.state, opponentFaceDown!.uid, "monsterZone", 1);
    opponentFaceDown!.position = "faceDownDefense";
    opponentFaceDown!.faceUp = false;
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
    expect(host.loadCardScript(Number(darkDustCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find(
      (action) => action.type === "tributeSummon" && action.uid === darkDust!.uid && action.tributeUids.includes(tribute!.uid) && !action.tributeUids.includes(ownFaceup!.uid),
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === darkDust!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);

    const destroyedUids = [ownFaceup!.uid, opponentAttack!.uid, opponentDefense!.uid];
    expect(restoredTriggerWindow.session.state.chain).toHaveLength(1);
    expect(restoredTriggerWindow.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "monsterZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-7-1100",
        "eventCardUid": "p0-deck-89111398-0",
        "eventCode": 1100,
        "eventCurrentState": {
          "controller": 0,
          "faceUp": true,
          "location": "monsterZone",
          "position": "faceUpAttack",
          "sequence": 0,
        },
        "eventName": "normalSummoned",
        "eventPlayer": 0,
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
        "id": "chain-6",
        "operationInfos": [
          {
            "category": 1,
            "count": 3,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-89111400-2",
              "p1-deck-89111401-0",
              "p1-deck-89111402-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-89111398-0",
      }
    `);
    assertDestroyOperationInfo(restoredTriggerWindow.session.state.chain[0]!, destroyedUids);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredChainWindow.restoreComplete, restoredChainWindow.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredChainWindow, 1);
    expect(restoredChainWindow.missingRegistryKeys).toEqual([]);
    expect(restoredChainWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredChainWindow.session.state.chain).toHaveLength(1);
    assertDestroyOperationInfo(restoredChainWindow.session.state.chain[0]!, destroyedUids);
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChainWindow, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChainWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    for (const uid of destroyedUids) {
      expect(restoredChainWindow.session.state.cards.find((card) => card.uid === uid)).toMatchObject({ location: "graveyard" });
    }
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === darkDust!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpAttack" });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === tribute!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === opponentFaceDown!.uid)).toMatchObject({
      location: "monsterZone",
      position: "faceDownDefense",
      faceUp: false,
    });
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownFaceup!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: darkDust!.uid,
        eventReasonEffectId: 7,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpDefense",
          sequence: 1,
        },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentAttack!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: darkDust!.uid,
        eventReasonEffectId: 7,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentDefense!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: darkDust!.uid,
        eventReasonEffectId: 7,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceUpDefense",
          sequence: 1,
        },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownFaceup!.uid,
        eventUids: destroyedUids,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: darkDust!.uid,
        eventReasonEffectId: 7,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpDefense",
          sequence: 1,
        },
      },
    ]);
    expect(restoredChainWindow.host.messages).not.toContain("dark dust responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("dark dust responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function assertDestroyOperationInfo(link: ChainLink, targetUids: string[]): void {
  expect(link.operationInfos).toHaveLength(1);
  const operationInfo = link.operationInfos?.[0];
  expect(operationInfo).toBeDefined();
  expect(operationInfo!).toMatchObject({ category: 0x1, count: targetUids.length, player: 0, parameter: 0 });
  expect(operationInfo!.targetUids).toHaveLength(targetUids.length);
  expect(operationInfo!.targetUids).toEqual(expect.arrayContaining(targetUids));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  }
}
