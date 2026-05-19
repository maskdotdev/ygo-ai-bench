import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasWitchScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c78010363.lua"));

describe.skipIf(!hasUpstreamScripts || !hasWitchScript)("Lua real script Witch of the Black Forest same-code activation lock", () => {
  it("restores its Defense-filtered search into a same-code activation lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const witchCode = "78010363";
    const searchedCode = "78010364";
    const allowedCode = "78010365";
    const highDefenseCode = "78010366";
    const spellDecoyCode = "78010367";
    const witchScript = workspace.readScript(`c${witchCode}.lua`);
    expect(witchScript).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
    expect(witchScript).toContain("e1:SetCode(EVENT_TO_GRAVE)");
    expect(witchScript).toContain("e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)");
    expect(witchScript).toContain("return c:IsDefenseBelow(1500) and c:IsMonster() and c:IsAbleToHand()");
    expect(witchScript).toContain("Duel.RegisterEffect(e1,tp)");
    expect(witchScript).toContain("return re:GetHandler():IsCode(e:GetLabel())");
    const cards: DuelCardData[] = [
      { code: witchCode, name: "Witch of the Black Forest", kind: "monster", typeFlags: 0x21, level: 4, attack: 1100, defense: 1200 },
      { code: searchedCode, name: "Witch Searched Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1800, defense: 1000 },
      { code: allowedCode, name: "Witch Different Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1800, defense: 1000 },
      { code: highDefenseCode, name: "Witch High DEF Decoy", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1600 },
      { code: spellDecoyCode, name: "Witch Spell Decoy", kind: "spell", typeFlags: 0x2 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 780, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [witchCode, searchedCode, highDefenseCode, spellDecoyCode, allowedCode] }, 1: { main: [] } });
    startDuel(session);

    const witch = requireCard(session, witchCode);
    const searched = requireCard(session, searchedCode);
    const allowed = requireCard(session, allowedCode);
    const highDefense = requireCard(session, highDefenseCode);
    const spellDecoy = requireCard(session, spellDecoyCode);
    moveDuelCard(session.state, witch.uid, "monsterZone", 0);
    witch.position = "faceUpAttack";
    witch.faceUp = true;
    moveDuelCard(session.state, allowed.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${searchedCode}.lua`) return responderScript("witch searched responder resolved");
        if (name === `c${allowedCode}.lua`) return responderScript("witch allowed responder resolved");
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(witchCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(searchedCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    sendDuelCardToGraveyard(session.state, witch.uid, 0, duelReason.effect, 0);
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === witch.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === searched.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === highDefense.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === spellDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: witch.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 0,
          position: "faceUpAttack",
          faceUp: true,
          sequence: 0,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 0,
          position: "faceUpAttack",
          faceUp: true,
          sequence: 0,
        },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: searched.uid,
        eventPreviousState: {
          location: "deck",
          controller: 0,
          position: "faceDown",
          faceUp: false,
          sequence: 4,
        },
        eventCurrentState: {
          location: "hand",
          controller: 0,
          position: "faceDown",
          faceUp: false,
          sequence: 1,
        },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: witch.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: searched.uid,
        eventUids: [searched.uid],
        eventPlayer: 1,
        eventValue: 1,
        eventPreviousState: {
          location: "deck",
          controller: 0,
          position: "faceDown",
          faceUp: false,
          sequence: 4,
        },
        eventCurrentState: {
          location: "hand",
          controller: 0,
          position: "faceDown",
          faceUp: false,
          sequence: 1,
        },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: witch.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: searched.uid,
        eventUids: [searched.uid],
        eventPlayer: 1,
        eventValue: 1,
        eventPreviousState: {
          location: "deck",
          controller: 0,
          position: "faceDown",
          faceUp: false,
          sequence: 4,
        },
        eventCurrentState: {
          location: "hand",
          controller: 0,
          position: "faceDown",
          faceUp: false,
          sequence: 1,
        },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: witch.uid,
        eventReasonEffectId: 1,
      },
    ]);

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredLock, 0);
    expect(restoredLock.session.state.effects.find((effect) => effect.sourceUid === witch.uid && effect.code === 6)).toMatchObject({
      event: "continuous",
      targetRange: [1, 0],
      luaValueDescriptor: "cannot-activate:same-code",
      label: Number(searchedCode),
    });
    restoredLock.session.state.phase = "main1";
    restoredLock.session.state.waitingFor = 0;
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "activateEffect" && action.uid === searched.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "activateEffect" && action.uid === allowed.uid)).toBe(true);
  });
});

function responderScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, waitingFor));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
