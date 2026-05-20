import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { ApplyDuelResponseResult, DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const snakeWhistleCode = "81791932";
const hasSnakeWhistleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${snakeWhistleCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeTrap = 0x4;
const raceReptile = 0x80000;
const raceWarrior = 0x1;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasSnakeWhistleScript)("Lua real script Snake Whistle destroyed Reptile deck summon", () => {
  it("restores Snake Whistle's EVENT_DESTROYED Trap activation and Special Summons a low-level Reptile from Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const destroyedReptileCode = "81791933";
    const reptileTargetCode = "81791934";
    const offRaceDecoyCode = "81791935";
    const highLevelDecoyCode = "81791936";
    const destroyerCode = "81791937";
    const responderCode = "81791938";
    const script = workspace.readScript(`c${snakeWhistleCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("return c:IsRace(RACE_REPTILE) and c:IsPreviousPosition(POS_FACEUP) and c:IsPreviousControler(tp)");
    expect(script).toContain("and c:IsPreviousLocation(LOCATION_MZONE)");
    expect(script).toContain("return c:IsLevelBelow(4) and c:IsRace(RACE_REPTILE) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: snakeWhistleCode, name: "Snake Whistle", kind: "trap", typeFlags: typeTrap },
      {
        code: destroyedReptileCode,
        name: "Snake Whistle Destroyed Reptile",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        race: raceReptile,
        attribute: attributeDark,
        level: 4,
        attack: 1200,
        defense: 800,
      },
      {
        code: reptileTargetCode,
        name: "Snake Whistle Reptile Target",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        race: raceReptile,
        attribute: attributeDark,
        level: 4,
        attack: 1400,
        defense: 1000,
      },
      {
        code: offRaceDecoyCode,
        name: "Snake Whistle Off-Race Decoy",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        race: raceWarrior,
        attribute: attributeDark,
        level: 4,
        attack: 1500,
        defense: 1000,
      },
      {
        code: highLevelDecoyCode,
        name: "Snake Whistle High-Level Decoy",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        race: raceReptile,
        attribute: attributeDark,
        level: 5,
        attack: 1800,
        defense: 1000,
      },
      { code: destroyerCode, name: "Snake Whistle Destroyer", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Snake Whistle Chain Responder", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 81791932, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [snakeWhistleCode, destroyedReptileCode, offRaceDecoyCode, highLevelDecoyCode, reptileTargetCode, destroyerCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const snakeWhistle = requireCard(session, snakeWhistleCode);
    const destroyedReptile = requireCard(session, destroyedReptileCode);
    const reptileTarget = requireCard(session, reptileTargetCode);
    const offRaceDecoy = requireCard(session, offRaceDecoyCode);
    const highLevelDecoy = requireCard(session, highLevelDecoyCode);
    const destroyer = requireCard(session, destroyerCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, snakeWhistle.uid, "spellTrapZone", 0);
    snakeWhistle.position = "faceDown";
    snakeWhistle.faceUp = false;
    moveDuelCard(session.state, destroyedReptile.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, destroyer.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${destroyerCode}.lua`) return destroyerScript(destroyedReptileCode);
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [snakeWhistleCode, destroyerCode, responderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);
    expect(session.state.effects.filter((effect) => effect.sourceUid === snakeWhistle.uid)).toEqual([
      expect.objectContaining({ event: "quick", triggerEvent: "destroyed", triggerCode: 1029, range: ["spellTrapZone"] }),
    ]);

    const destroy = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroy, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, destroy!);
    resolveEngineChain(session);

    expect(session.state.cards.find((card) => card.uid === destroyedReptile.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: destroyer.uid,
    });
    expect(session.state.pendingTriggers).toEqual([]);
    expect(session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === destroyedReptile.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyedReptile.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 2,
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

    const restoredActivationWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivationWindow);
    expect(restoredActivationWindow.session.state.effects.filter((effect) => effect.sourceUid === snakeWhistle.uid)).toEqual([
      expect.objectContaining({ event: "quick", triggerEvent: "destroyed", triggerCode: 1029, range: ["spellTrapZone"] }),
    ]);
    expect(
      restoredActivationWindow.session.state.eventHistory.map((event) => ({
        eventName: event.eventName,
        eventCardUid: event.eventCardUid,
      })),
    ).toContainEqual({ eventName: "destroyed", eventCardUid: destroyedReptile.uid });
    expectRestoredLegalActions(restoredActivationWindow, 0);
    const whistleAction = getLuaRestoreLegalActions(restoredActivationWindow, 0).find(
      (action) => action.type === "activateEffect" && action.uid === snakeWhistle.uid,
    );
    expect(whistleAction, JSON.stringify(getLuaRestoreLegalActions(restoredActivationWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivationWindow, whistleAction!);
    expect(restoredActivationWindow.session.state.chain).toEqual([
      {
        id: "chain-6",
        chainIndex: 1,
        effectId: "lua-1-1029",
        sourceUid: snakeWhistle.uid,
        player: 0,
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyedReptile.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 2,
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
        operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivationWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === snakeWhistle.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === destroyedReptile.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === offRaceDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === highLevelDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === reptileTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: snakeWhistle.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === reptileTarget.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: reptileTarget.uid,
        eventUids: [reptileTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: snakeWhistle.uid,
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
    expect(restoredChain.host.messages).not.toContain("snake whistle responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function destroyerScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsExistingMatchingCard(Card.IsCode,tp,LOCATION_MZONE,0,1,nil,${targetCode}) end
      end)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetMatchingGroup(Card.IsCode,tp,LOCATION_MZONE,0,nil,${targetCode}):GetFirst()
        if tc then Duel.Destroy(tc,REASON_EFFECT) end
      end)
      c:RegisterEffect(e)
    end
  `;
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
      e:SetOperation(function(e,tp) Debug.Message("snake whistle responder resolved") end)
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

function applyAndAssert(session: DuelSession, action: DuelAction): ApplyDuelResponseResult {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
  return response;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveEngineChain(session: DuelSession): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLegalActions(session, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player!), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    const response = applyLuaRestoreResponse(restored, pass!);
    expect(response.ok, response.error).toBe(true);
  }
}
