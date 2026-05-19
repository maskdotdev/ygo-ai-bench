import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Princess of Tsurugi flip field-count damage", () => {
  it("restores its Flip target-player Spell/Trap count damage and resolves through CHAININFO", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const princessCode = "51371017";
    const firstBackrowCode = "51371018";
    const secondBackrowCode = "51371019";
    const responderCode = "51371020";
    const script = workspace.readScript(`c${princessCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DAMAGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)");
    expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
    expect(script).toContain("Duel.GetFieldGroupCount(tp,0,LOCATION_SZONE)*500");
    expect(script).toContain("Duel.SetTargetParam(dam)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,dam)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER)");
    expect(script).toContain("Duel.GetFieldGroupCount(p,LOCATION_SZONE,0)*500");
    expect(script).toContain("Duel.Damage(p,dam,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === princessCode),
      { code: firstBackrowCode, name: "Princess First Backrow", kind: "spell", typeFlags: typeSpell },
      { code: secondBackrowCode, name: "Princess Second Backrow", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Princess Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 51371017, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [princessCode] }, 1: { main: [firstBackrowCode, secondBackrowCode, responderCode] } });
    startDuel(session);

    const princess = requireCard(session, princessCode);
    const firstBackrow = requireCard(session, firstBackrowCode);
    const secondBackrow = requireCard(session, secondBackrowCode);
    const responder = requireCard(session, responderCode);
    const movedPrincess = moveDuelCard(session.state, princess.uid, "monsterZone", 0);
    movedPrincess.position = "faceDownDefense";
    movedPrincess.faceUp = false;
    moveDuelCard(session.state, firstBackrow.uid, "spellTrapZone", 1);
    firstBackrow.position = "faceDown";
    firstBackrow.faceUp = false;
    moveDuelCard(session.state, secondBackrow.uid, "spellTrapZone", 1);
    secondBackrow.position = "faceDown";
    secondBackrow.faceUp = false;
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
    expect(host.loadCardScript(Number(princessCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const flip = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "flipSummon" && action.uid === princess.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, flip!);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-1",
        eventCardUid: princess.uid,
        eventCode: 1101,
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventName: "flipSummoned",
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        id: "trigger-3-1",
        player: 0,
        sourceUid: princess.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === princess.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        activationLocation: "monsterZone",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-1",
        eventCardUid: princess.uid,
        eventCode: 1101,
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventName: "flipSummoned",
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        id: "chain-3",
        operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 1000 }],
        player: 0,
        sourceUid: princess.uid,
        targetParam: 1000,
        targetPlayer: 1,
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(restoredChain.session.state.chain).toEqual(restoredTrigger.session.state.chain);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredChain, pass!);

    expect(restoredChain.session.state.chain).toEqual([]);
    expect(restoredChain.session.state.cards.find((card) => card.uid === princess.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(restoredChain.session.state.cards.find((card) => card.uid === firstBackrow.uid)).toMatchObject({ location: "spellTrapZone", controller: 1 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === secondBackrow.uid)).toMatchObject({ location: "spellTrapZone", controller: 1 });
    expect(restoredChain.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["flipSummoned", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "flipSummoned",
        eventCode: 1101,
        eventCardUid: princess.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: princess.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restoredChain.host.messages).not.toContain("princess responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("princess responder resolved") end)
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
