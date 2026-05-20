import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const chimeraCode = "13482075";
const hasChimeraScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chimeraCode}.lua`));
const starterCode = "134820750";
const zombieCostCode = "134820751";
const typeMonster = 0x1;
const typeSpell = 0x2;
const raceZombie = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasChimeraScript)("Lua real script Vendread Chimera chain negate cost", () => {
  it("restores destroy-operation chain negation with Zombie GY banish cost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${chimeraCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_NEGATE+CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)");
    expect(script).toContain("Duel.IsChainNegatable(ev)");
    expect(script).toContain("Duel.GetOperationInfo(ev,CATEGORY_DESTROY)");
    expect(script).toContain("return ex and tg~=nil and tc+tg:FilterCount(Card.IsOnField,nil)-#tg>0");
    expect(script).toContain("return c:IsRace(RACE_ZOMBIE) and c:IsAbleToRemoveAsCost()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
    expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_NEGATE,eg,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,eg,1,0,0)");
    expect(script).toContain("Duel.NegateActivation(ev)");
    expect(script).toContain("Duel.Destroy(eg,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === chimeraCode),
      { code: starterCode, name: "Vendread Chimera Destroy Starter", kind: "spell", typeFlags: typeSpell },
      { code: zombieCostCode, name: "Vendread Chimera Zombie Cost", kind: "monster", typeFlags: typeMonster, race: raceZombie, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 13482075, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [chimeraCode, zombieCostCode] }, 1: { main: [starterCode] } });
    startDuel(session);

    const chimera = requireCard(session, chimeraCode);
    const zombieCost = requireCard(session, zombieCostCode);
    const starter = requireCard(session, starterCode);
    moveDuelCard(session.state, chimera.uid, "monsterZone", 0).position = "faceUpAttack";
    chimera.faceUp = true;
    moveDuelCard(session.state, zombieCost.uid, "graveyard", 0).position = "faceUpAttack";
    zombieCost.faceUp = true;
    moveDuelCard(session.state, starter.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return destroyStarterScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(chimeraCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const starterAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-5-1002",
        sourceUid: starter.uid,
        player: 1,
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x1, targetUids: [starter.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenChain);
    expectRestoredLegalActions(restoredOpenChain, 0);
    const chimeraAction = getLuaRestoreLegalActions(restoredOpenChain, 0).find((action) => action.type === "activateEffect" && action.uid === chimera.uid);
    expect(chimeraAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpenChain, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenChain, chimeraAction!);

    expect(restoredOpenChain.host.messages).not.toContain("vendread chimera starter resolved");
    expect(restoredOpenChain.session.state.chain).toEqual([]);
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === zombieCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: chimera.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: chimera.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpenChain.session.state.eventHistory.filter((event) => ["banished", "destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: zombieCost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: chimera.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: starter.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: chimera.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 5,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 5,
      },
    ]);
  });
});

function destroyStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_DESTROY,Group.FromCards(e:GetHandler()),1,0,0)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("vendread chimera starter resolved")
        Duel.Destroy(e:GetHandler(),REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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
