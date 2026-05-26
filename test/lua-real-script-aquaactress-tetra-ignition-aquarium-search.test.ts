import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTetraScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c39260991.lua"));

const tetraCode = "39260991";
const aquariumSpellCode = "39260992";
const offSetSpellCode = "39260993";
const offTypeAquariumCode = "39260994";
const responderCode = "39260995";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const setAquarium = 0x20cd;

describe.skipIf(!hasUpstreamScripts || !hasTetraScript)("Lua real script Aquaactress Tetra ignition Aquarium search", () => {
  it("restores a costless monster-zone ignition search and confirms the Aquarium card", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${tetraCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e1:SetCountLimit(1)");
    expect(script).toContain("return c:IsSetCard(SET_AQUARIUM) and c:IsAbleToHand()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      { code: tetraCode, name: "Aquaactress Tetra", kind: "monster", typeFlags: typeMonster | typeEffect, level: 1, attack: 300, defense: 300 },
      { code: aquariumSpellCode, name: "Aquaactress Tetra Aquarium Target", kind: "spell", typeFlags: typeSpell, setcodes: [setAquarium] },
      { code: offSetSpellCode, name: "Aquaactress Tetra Off-Set Spell Decoy", kind: "spell", typeFlags: typeSpell, setcodes: [0x123] },
      { code: offTypeAquariumCode, name: "Aquaactress Tetra Off-Set Monster Decoy", kind: "monster", typeFlags: typeMonster, level: 4, setcodes: [0x123] },
      { code: responderCode, name: "Aquaactress Tetra Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 39260991, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tetraCode, aquariumSpellCode, offSetSpellCode, offTypeAquariumCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const tetra = requireCard(session, tetraCode);
    const aquariumSpell = requireCard(session, aquariumSpellCode);
    const offSetSpell = requireCard(session, offSetSpellCode);
    const offTypeAquarium = requireCard(session, offTypeAquariumCode);
    const responder = requireCard(session, responderCode);
    const movedTetra = moveDuelCard(session.state, tetra.uid, "monsterZone", 0);
    movedTetra.position = "faceUpAttack";
    movedTetra.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript(name: string) { return name === `c${responderCode}.lua` ? chainResponderScript() : workspace.readScript(name); } };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tetraCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === tetra.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toHaveLength(1);
    expect(restoredOpen.session.state.chain[0]!.operationInfos).toEqual([{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }]);
    expectRestoredLegalActions(restoredOpen, 1);
    expect(getLuaRestoreLegalActions(restoredOpen, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredOpen);
    expect(restoredOpen.session.state.chain).toHaveLength(0);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === tetra.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === tetra.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === aquariumSpell.uid)).toMatchObject({ location: "hand", controller: 0, reason: duelReason.effect });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === offSetSpell.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === offTypeAquarium.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredOpen.host.messages).not.toContain("aquaactress tetra responder resolved");
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      sentToHandEvent(aquariumSpell.uid, tetra.uid),
      confirmedEvent(aquariumSpell.uid, tetra.uid),
      sentToHandConfirmedEvent(aquariumSpell.uid, tetra.uid),
    ]);
  });
});

function sentToHandEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
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
      e:SetOperation(function(e,tp) Debug.Message("aquaactress tetra responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): ReturnType<typeof applyLuaRestoreResponse> {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(restored.session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
  return response;
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
}
