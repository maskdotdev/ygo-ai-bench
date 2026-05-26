import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Kinka-byo relation banish", () => {
  it.fails("restores its revive relation and banishes the revived monster when Kinka-byo leaves", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const kinkaCode = "45452224";
    const reviveCode = "45452225";
    const invalidCode = "45452226";
    const responderCode = "45452227";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === kinkaCode),
      { code: reviveCode, name: "Kinka-byo Level 1 Revive", kind: "monster", typeFlags: 0x1, level: 1, attack: 300, defense: 200 },
      { code: invalidCode, name: "Kinka-byo Level 4 Non-Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1000 },
      { code: responderCode, name: "Kinka-byo Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 454, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kinkaCode, reviveCode, invalidCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const kinka = session.state.cards.find((card) => card.code === kinkaCode);
    const revive = session.state.cards.find((card) => card.code === reviveCode);
    const invalid = session.state.cards.find((card) => card.code === invalidCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(kinka).toBeDefined();
    expect(revive).toBeDefined();
    expect(invalid).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, kinka!.uid, "hand", 0);
    moveDuelCard(session.state, revive!.uid, "graveyard", 0);
    moveDuelCard(session.state, invalid!.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(kinkaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === kinka!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === kinka!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toHaveLength(1);
    expect(restoredTriggerWindow.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "monsterZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-7-1100",
        "eventCardUid": "p0-deck-45452224-0",
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
        "id": "chain-4",
        "operationInfos": [
          {
            "category": 512,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-45452225-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-45452224-0",
        "targetFieldIds": [
          6,
        ],
        "targetUids": [
          "p0-deck-45452225-1",
        ],
      }
    `);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredChainWindow.restoreComplete, restoredChainWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChainWindow.missingRegistryKeys).toEqual([]);
    expect(restoredChainWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChainWindow, 1);
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChainWindow, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChainWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === revive!.uid)).toMatchObject({ location: "monsterZone", summonType: "special" });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === invalid!.uid)).toMatchObject({ location: "graveyard" });

    const restoredRelationWindow = restoreDuelWithLuaScripts(serializeDuel(restoredChainWindow.session), source, reader);
    expect(restoredRelationWindow.restoreComplete, restoredRelationWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredRelationWindow.missingRegistryKeys).toEqual([]);
    expect(restoredRelationWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredRelationWindow, 0);
    const relationProbe = restoredRelationWindow.host.loadScript(
      `
      local kinka=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${kinkaCode}), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local revived=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${reviveCode}), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("kinka relation " .. tostring(kinka:IsHasCardTarget(revived)) .. "/" .. tostring(kinka:IsRelateToCard(revived)) .. "/" .. tostring(revived:IsRelateToCard(kinka)))
      `,
      "kinka-relation-probe.lua",
    );
    expect(relationProbe.ok, relationProbe.error).toBe(true);
    expect(restoredRelationWindow.host.messages).toContain("kinka relation true/true/true");

    const leave = restoredRelationWindow.host.loadScript(
      `
      local kinka=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${kinkaCode}), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("kinka leaves " .. Duel.SendtoGrave(kinka, REASON_EFFECT))
      `,
      "kinka-leaves-field.lua",
    );
    expect(leave.ok, leave.error).toBe(true);
    expect(restoredRelationWindow.host.messages).toContain("kinka leaves 1");
    expect(restoredRelationWindow.session.state.cards.find((card) => card.uid === kinka!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredRelationWindow.session.state.cards.find((card) => card.uid === revive!.uid)).toMatchObject({ location: "banished", faceUp: true });
    expect(restoredRelationWindow.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: revive!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: kinka!.uid,
        eventReasonEffectId: 7,
        eventUids: [revive!.uid],
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);
    expect(restoredRelationWindow.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === revive!.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: revive!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: kinka!.uid,
        eventReasonEffectId: 9,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "banished",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restoredRelationWindow.host.messages).not.toContain("kinka responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("kinka responder resolved") end)
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
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
