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
const crystalBeaconCode = "95326659";
const hasCrystalBeaconScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${crystalBeaconCode}.lua`));
const zoneCrystalOneCode = "95326660";
const zoneCrystalTwoCode = "95326661";
const summonTargetCode = "95326662";
const offSetDeckDecoyCode = "95326663";
const responderCode = "95326664";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const setCrystalBeast = 0x1034;

describe.skipIf(!hasUpstreamScripts || !hasCrystalBeaconScript)("Lua real script Crystal Beacon SZONE setcode deck summon", () => {
  it("restores two face-up Crystal Beast Spell/Trap Zone condition and deck Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${crystalBeaconCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_CRYSTAL_BEAST),tp,LOCATION_SZONE,0,2,nil)");
    expect(script).toContain("return c:IsSetCard(SET_CRYSTAL_BEAST) and c:IsCanBeSpecialSummoned(e,0,tp,true,false)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_DECK,0,1,nil,e,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,0,LOCATION_DECK)");
    expect(script).toContain("if not Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_CRYSTAL_BEAST),tp,LOCATION_SZONE,0,2,nil) then return end");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,true,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: crystalBeaconCode, name: "Crystal Beacon", kind: "spell", typeFlags: typeSpell },
      { code: zoneCrystalOneCode, name: "Crystal Beacon Zone Crystal 1", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setCrystalBeast], level: 4, attack: 1800, defense: 1000 },
      { code: zoneCrystalTwoCode, name: "Crystal Beacon Zone Crystal 2", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setCrystalBeast], level: 4, attack: 1600, defense: 1200 },
      { code: summonTargetCode, name: "Crystal Beacon Deck Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setCrystalBeast], level: 4, attack: 1700, defense: 800 },
      { code: offSetDeckDecoyCode, name: "Crystal Beacon Off-Set Deck Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [0x123], level: 4, attack: 1900, defense: 900 },
      { code: responderCode, name: "Crystal Beacon Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 95326659, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [crystalBeaconCode, zoneCrystalOneCode, zoneCrystalTwoCode, offSetDeckDecoyCode, summonTargetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const beacon = requireCard(session, crystalBeaconCode);
    const zoneCrystalOne = requireCard(session, zoneCrystalOneCode);
    const zoneCrystalTwo = requireCard(session, zoneCrystalTwoCode);
    const summonTarget = requireCard(session, summonTargetCode);
    const offSetDeckDecoy = requireCard(session, offSetDeckDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, beacon.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    moveFaceUpToSpellTrap(session, zoneCrystalOne.uid, 0);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(crystalBeaconCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(getLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.uid === beacon.uid)).toBe(false);

    moveFaceUpToSpellTrap(session, zoneCrystalTwo.uid, 0);
    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === beacon.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.chain).toEqual([
      {
        activationLocation: "hand",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-1-1002",
        id: "chain-2",
        operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
        player: 0,
        sourceUid: beacon.uid,
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === beacon.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === zoneCrystalOne.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === zoneCrystalTwo.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === offSetDeckDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === summonTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: beacon.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === summonTarget.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: summonTarget.uid,
        eventUids: [summonTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: beacon.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restored.host.messages).not.toContain("crystal beacon responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpToSpellTrap(session: DuelSession, uid: string, controller: 0 | 1): void {
  const card = moveDuelCard(session.state, uid, "spellTrapZone", controller);
  card.faceUp = true;
  card.position = "faceUpAttack";
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
      e:SetOperation(function(e,tp) Debug.Message("crystal beacon responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
