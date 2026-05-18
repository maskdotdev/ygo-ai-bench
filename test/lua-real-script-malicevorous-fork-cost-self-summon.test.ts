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
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const raceFiend = 0x8;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Malicevorous Fork cost self summon", () => {
  it("restores hand cost send-to-Graveyard and self Special Summon from hand", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const forkCode = "61791132";
    const fiendCostCode = "61791133";
    const warriorDecoyCode = "61791134";
    const responderCode = "61791135";
    const forkScript = workspace.readScript(`c${forkCode}.lua`);
    expect(forkScript).toContain("Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_HAND,0,1,e:GetHandler())");
    expect(forkScript).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_HAND,0,1,1,e:GetHandler())");
    expect(forkScript).toContain("Duel.SendtoGrave(g,REASON_COST)");
    expect(forkScript).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)");
    expect(forkScript).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === forkCode),
      { code: fiendCostCode, name: "Malicevorous Fork Fiend Cost", kind: "monster", typeFlags: typeMonster, race: raceFiend, level: 4, attack: 1000, defense: 1000 },
      { code: warriorDecoyCode, name: "Malicevorous Fork Warrior Decoy", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Malicevorous Fork Chain Responder", kind: "monster", typeFlags: typeMonster, race: raceFiend, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 61791132, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [forkCode, warriorDecoyCode, fiendCostCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const fork = requireCard(session, forkCode);
    const fiendCost = requireCard(session, fiendCostCode);
    const warriorDecoy = requireCard(session, warriorDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, fork.uid, "hand", 0);
    moveDuelCard(session.state, warriorDecoy.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(forkCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(getLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.uid === fork.uid)).toBe(false);

    moveDuelCard(session.state, fiendCost.uid, "hand", 0);
    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === fork.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    expect(session.state.cards.find((card) => card.uid === fork.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(session.state.cards.find((card) => card.uid === warriorDecoy.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(session.state.cards.find((card) => card.uid === fiendCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: fork.uid,
    });
    expect(session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === fiendCost.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: fiendCost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: fork.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 2,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1",
      id: "chain-3",
      operationInfos: [{ category: 0x200, targetUids: [fork.uid], count: 1, player: 0, parameter: 0 }],
      player: 0,
      sourceUid: fork.uid,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === fiendCost.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: fiendCost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: fork.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 2,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restored.session.state.chain[0]).toEqual({
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1",
      id: "chain-3",
      operationInfos: [{ category: 0x200, targetUids: [fork.uid], count: 1, player: 0, parameter: 0 }],
      player: 0,
      sourceUid: fork.uid,
    });
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    passChain(restored);

    expect(restored.session.state.chain).toHaveLength(0);
    expect(restored.session.state.cards.find((card) => card.uid === fork.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === warriorDecoy.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === fiendCost.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === fork.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: fork.uid,
        eventUids: [fork.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: fork.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
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
    expect(host.messages).not.toContain("malicevorous fork responder resolved");
    expect(restored.host.messages).not.toContain("malicevorous fork responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("malicevorous fork responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
  }
}
