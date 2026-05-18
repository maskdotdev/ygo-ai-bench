import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceRock = 0x100;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Release from Stone banished revive destroy", () => {
  it("restores its banished Rock target, SpecialSummonStep relation, and mutual destruction cleanup", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const releaseCode = "26956670";
    const rockTargetCode = "26956671";
    const warriorDecoyCode = "26956672";
    const facedownRockCode = "26956673";
    const responderCode = "26956674";
    const script = workspace.readScript(`c${releaseCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_ROCK) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,LOCATION_REMOVED,0,1,nil,e,tp)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_REMOVED,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("c:SetCardTarget(tc)");
    expect(script).toContain("Duel.SpecialSummonComplete()");
    expect(script).toContain("Duel.Destroy(e:GetHandler(),REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === releaseCode),
      { code: rockTargetCode, name: "Release from Stone Banished Rock", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, level: 4, attack: 1500, defense: 1200 },
      { code: warriorDecoyCode, name: "Release from Stone Banished Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1600, defense: 1000 },
      { code: facedownRockCode, name: "Release from Stone Face-Down Rock Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, level: 4, attack: 1400, defense: 1400 },
      { code: responderCode, name: "Release from Stone Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 26956670, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [releaseCode, warriorDecoyCode, facedownRockCode, rockTargetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const release = requireCard(session, releaseCode);
    const rockTarget = requireCard(session, rockTargetCode);
    const warriorDecoy = requireCard(session, warriorDecoyCode);
    const facedownRock = requireCard(session, facedownRockCode);
    const responder = requireCard(session, responderCode);
    const movedRelease = moveDuelCard(session.state, release.uid, "spellTrapZone", 0);
    movedRelease.position = "faceDown";
    movedRelease.faceUp = false;
    moveDuelCard(session.state, rockTarget.uid, "banished", 0).faceUp = true;
    moveDuelCard(session.state, warriorDecoy.uid, "banished", 0).faceUp = true;
    const movedFacedownRock = moveDuelCard(session.state, facedownRock.uid, "banished", 0);
    movedFacedownRock.faceUp = false;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(releaseCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === release.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    expect(restoredActivation.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: release.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        targetUids: [rockTarget.uid],
        operationInfos: [{ category: 0x200, targetUids: [rockTarget.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.cards.find((card) => card.uid === release.uid)).toMatchObject({
      location: "spellTrapZone",
      faceUp: true,
      cardTargetUids: [rockTarget.uid],
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === rockTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "special",
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === warriorDecoy.uid)).toMatchObject({ location: "banished", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === facedownRock.uid)).toMatchObject({ location: "banished", controller: 0, faceUp: false });
    expect(restoredChain.host.messages).not.toContain("release from stone responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === rockTarget.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: rockTarget.uid,
        eventUids: [rockTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: release.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "banished",
          position: "faceDown",
          sequence: 0,
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

    const restoredRelation = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredRelation);
    expectRestoredLegalActions(restoredRelation, 0);
    expectLuaReleaseProbe(restoredRelation, rockTargetCode, releaseCode, "release probe 0/26956671/1");

    destroyDuelCard(restoredRelation.session.state, release.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredRelation.session.state.cards.find((card) => card.uid === release.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredRelation.session.state.cards.find((card) => card.uid === rockTarget.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
    });
    const restoredTrapDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredRelation.session), source, reader);
    expectCleanRestore(restoredTrapDestroyed);
    expectRestoredLegalActions(restoredTrapDestroyed, 0);

    const restoredTargetDestroy = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredTargetDestroy);
    expectRestoredLegalActions(restoredTargetDestroy, 0);
    destroyDuelCard(restoredTargetDestroy.session.state, rockTarget.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredTargetDestroy.session.state.cards.find((card) => card.uid === rockTarget.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredTargetDestroy.session.state.cards.find((card) => card.uid === release.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      reason: duelReason.effect | duelReason.destroy,
    });
    const restoredMonsterDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredTargetDestroy.session), source, reader);
    expectCleanRestore(restoredMonsterDestroyed);
    expectRestoredLegalActions(restoredMonsterDestroyed, 0);
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
      e:SetOperation(function(e,tp) Debug.Message("release from stone responder resolved") end)
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
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function expectLuaReleaseProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, targetCode: string, releaseCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local trap=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${releaseCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      local first=trap and trap:GetFirstCardTarget()
      Debug.Message("release probe " .. target:GetControler() .. "/" .. tostring(first and first:GetCode()) .. "/" .. trap:GetCardTargetCount())
    `,
    "release-from-stone-relation-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
