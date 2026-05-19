import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeSpell = 0x2;
const racePlant = 0x400;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Pollinosis release-cost activation negate", () => {
  it("restores its Plant release cost, activation negation, source destruction, and suppressed Spell operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const pollinosisCode = "91078716";
    const starterCode = "910787160";
    const drawnCode = "910787161";
    const plantCode = "910787162";
    const script = workspace.readScript(`c${pollinosisCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DISABLE_SUMMON+CATEGORY_DESTROY)");
    expect(script).toContain("e3:SetCategory(CATEGORY_NEGATE+CATEGORY_DESTROY)");
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.filter,1,false,nil,nil)");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.filter,1,1,false,nil,nil)");
    expect(script).toContain("return c:IsRace(RACE_PLANT) and not c:IsStatus(STATUS_BATTLE_DESTROYED)");
    expect(script).toContain("return re:IsHasType(EFFECT_TYPE_ACTIVATE) and Duel.IsChainNegatable(ev)");
    expect(script).toContain("Duel.NegateActivation(ev)");
    expect(script).toContain("Duel.Destroy(eg,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === pollinosisCode),
      { code: starterCode, name: "Pollinosis Spell Activation", kind: "spell", typeFlags: typeSpell },
      { code: drawnCode, name: "Pollinosis Suppressed Draw", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: plantCode, name: "Pollinosis Plant Release", kind: "monster", typeFlags: typeMonster, race: racePlant, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 91078716, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterCode, drawnCode] }, 1: { main: [pollinosisCode, plantCode] } });
    startDuel(session);

    const pollinosis = requireCard(session, pollinosisCode);
    const starter = requireCard(session, starterCode);
    const drawn = requireCard(session, drawnCode);
    const plant = requireCard(session, plantCode);
    moveDuelCard(session.state, starter.uid, "hand", 0);
    moveDuelCard(session.state, pollinosis.uid, "spellTrapZone", 1);
    pollinosis.position = "faceDown";
    pollinosis.faceUp = false;
    moveDuelCard(session.state, plant.uid, "monsterZone", 1).position = "faceUpAttack";
    plant.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return spellDrawScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [pollinosisCode, starterCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(2);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      id: "chain-2",
      operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 }],
      player: 0,
      sourceUid: starter.uid,
    });

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenChain);
    expectRestoredLegalActions(restoredOpenChain, 1);
    const pollinosisAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === pollinosis.uid);
    expect(pollinosisAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpenChain, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenChain, pollinosisAction!);
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === plant.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      previousController: 1,
      reasonPlayer: 1,
    });
    expect(restoredOpenChain.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === plant.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: plant.uid,
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
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 1,
        eventReasonCardUid: pollinosis.uid,
        eventReasonEffectId: 4,
      },
    ]);
    expect(restoredOpenChain.session.state.chain).toHaveLength(0);
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === pollinosis.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === plant.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === drawn.uid)).toMatchObject({ location: "deck" });
    expect(restoredOpenChain.host.messages).not.toContain("pollinosis spell resolved");
    expect(restoredOpenChain.session.state.eventHistory.filter((event) => ["destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: starter.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: pollinosis.uid,
        eventReasonEffectId: 4,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 1,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 1,
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpenChain.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, restoredResolved.session.state.waitingFor ?? restoredResolved.session.state.turnPlayer);
    expect(restoredResolved.session.state.chain).toHaveLength(0);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === drawn.uid)).toMatchObject({ location: "deck" });
    expect(restoredResolved.host.messages).not.toContain("pollinosis spell resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function spellDrawScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("pollinosis spell resolved")
        Duel.Draw(tp,1,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const result = applyResponse(session, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = result.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
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
