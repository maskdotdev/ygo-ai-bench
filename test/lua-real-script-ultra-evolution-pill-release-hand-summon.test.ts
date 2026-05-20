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
const ultraEvolutionPillCode = "22431243";
const hasUltraEvolutionPillScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ultraEvolutionPillCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceWarrior = 0x1;
const raceDinosaur = 0x10000;
const raceReptile = 0x80000;
const attributeEarth = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUltraEvolutionPillScript)("Lua real script Ultra Evolution Pill release hand summon", () => {
  it("restores CheckReleaseGroup activation cost and Special Summons a Dinosaur from hand", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const reptileCostCode = "22431244";
    const dinosaurTargetCode = "22431245";
    const warriorReleaseDecoyCode = "22431246";
    const warriorHandDecoyCode = "22431247";
    const responderCode = "22431248";
    const script = workspace.readScript(`c${ultraEvolutionPillCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("Duel.CheckReleaseGroup(tp,s.cfilter,1,nil,ft,tp)");
    expect(script).toContain("Duel.SelectReleaseGroup(tp,s.cfilter,1,1,nil,ft,tp)");
    expect(script).toContain("Duel.Release(g,REASON_COST)");
    expect(script).toContain("return c:IsRace(RACE_DINOSAUR) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_HAND,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: ultraEvolutionPillCode, name: "Ultra Evolution Pill", kind: "spell", typeFlags: typeSpell },
      {
        code: reptileCostCode,
        name: "Ultra Evolution Pill Reptile Cost",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        race: raceReptile,
        attribute: attributeEarth,
        level: 4,
        attack: 1200,
        defense: 800,
      },
      {
        code: dinosaurTargetCode,
        name: "Ultra Evolution Pill Dinosaur Target",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        race: raceDinosaur,
        attribute: attributeEarth,
        level: 6,
        attack: 2200,
        defense: 1600,
      },
      {
        code: warriorReleaseDecoyCode,
        name: "Ultra Evolution Pill Warrior Release Decoy",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        race: raceWarrior,
        attribute: attributeEarth,
        level: 4,
        attack: 1500,
        defense: 1000,
      },
      {
        code: warriorHandDecoyCode,
        name: "Ultra Evolution Pill Warrior Hand Decoy",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        race: raceWarrior,
        attribute: attributeEarth,
        level: 6,
        attack: 2100,
        defense: 1400,
      },
      { code: responderCode, name: "Ultra Evolution Pill Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 22431243, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [ultraEvolutionPillCode, reptileCostCode, warriorReleaseDecoyCode, warriorHandDecoyCode, dinosaurTargetCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const pill = requireCard(session, ultraEvolutionPillCode);
    const reptileCost = requireCard(session, reptileCostCode);
    const dinosaurTarget = requireCard(session, dinosaurTargetCode);
    const warriorReleaseDecoy = requireCard(session, warriorReleaseDecoyCode);
    const warriorHandDecoy = requireCard(session, warriorHandDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, pill.uid, "hand", 0);
    moveDuelCard(session.state, dinosaurTarget.uid, "hand", 0);
    moveDuelCard(session.state, warriorHandDecoy.uid, "hand", 0);
    moveDuelCard(session.state, reptileCost.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, warriorReleaseDecoy.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
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
    expect(host.loadCardScript(Number(ultraEvolutionPillCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === pill.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    expect(session.state.cards.find((card) => card.uid === pill.uid)).toMatchObject({ location: "spellTrapZone", controller: 0 });
    expect(session.state.cards.find((card) => card.uid === reptileCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: pill.uid,
      reasonEffectId: 1,
    });
    expect(session.state.cards.find((card) => card.uid === warriorReleaseDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(session.state.chain).toEqual([
      {
        activationLocation: "hand",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-1-1002",
        id: "chain-3",
        operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }],
        player: 0,
        sourceUid: pill.uid,
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.chain[0]).toEqual({
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      id: "chain-3",
      operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }],
      player: 0,
      sourceUid: pill.uid,
    });
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === pill.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === reptileCost.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === warriorReleaseDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === warriorHandDecoy.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === dinosaurTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: pill.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === reptileCost.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: reptileCost.uid,
        eventReason: duelReason.release | duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: pill.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === dinosaurTarget.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: dinosaurTarget.uid,
        eventUids: [dinosaurTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: pill.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
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
    expect(host.messages).not.toContain("ultra evolution pill responder resolved");
    expect(restored.host.messages).not.toContain("ultra evolution pill responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
      e:SetOperation(function(e,tp) Debug.Message("ultra evolution pill responder resolved") end)
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

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
  }
}
