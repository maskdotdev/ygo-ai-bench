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
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const setAdamancipator = 0x140;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Adamancipator Resonance Damage Calculation negate", () => {
  it("restores its Damage Calculation Adamancipator Synchro gate, monster activation negation, source destruction, and suppressed operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const resonanceCode = "45730592";
    const attackerCode = "457305920";
    const synchroCode = "457305921";
    const starterMonsterCode = "457305922";
    const drawnCode = "457305923";
    const chainResponderCode = "457305924";
    const script = workspace.readScript(`c${resonanceCode}.lua`);
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)");
    expect(script).toContain("return Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_ADAMANCIPATOR) and c:IsType(TYPE_SYNCHRO)");
    expect(script).toContain("and re:IsMonsterEffect() and Duel.IsChainNegatable(ev)");
    expect(script).toContain("Duel.NegateActivation(ev)");
    expect(script).toContain("Duel.Destroy(eg,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === resonanceCode),
      { code: attackerCode, name: "Adamancipator Resonance Attacker", kind: "monster", typeFlags: typeMonster, attack: 1800, defense: 1200 },
      { code: synchroCode, name: "Adamancipator Resonance Synchro Gate", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, setcodes: [setAdamancipator], attack: 2200, defense: 1800 },
      { code: starterMonsterCode, name: "Adamancipator Suppressed Damage Calculation Monster", kind: "monster", typeFlags: typeMonster | typeEffect, attack: 500, defense: 500 },
      { code: drawnCode, name: "Adamancipator Suppressed Draw", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: chainResponderCode, name: "Adamancipator Chain Responder", kind: "spell", typeFlags: typeSpell, attack: 0, defense: 0 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 45730592, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode, starterMonsterCode, drawnCode, chainResponderCode] }, 1: { main: [resonanceCode], extra: [synchroCode] } });
    startDuel(session);

    const resonance = requireCard(session, resonanceCode);
    const attacker = requireCard(session, attackerCode);
    const synchro = requireCard(session, synchroCode);
    const starterMonster = requireCard(session, starterMonsterCode);
    const drawn = requireCard(session, drawnCode);
    moveDuelCard(session.state, attacker.uid, "monsterZone", 0).position = "faceUpAttack";
    attacker.faceUp = true;
    moveDuelCard(session.state, synchro.uid, "monsterZone", 1).position = "faceUpAttack";
    synchro.faceUp = true;
    moveDuelCard(session.state, resonance.uid, "spellTrapZone", 1).position = "faceDown";
    resonance.faceUp = false;
    moveDuelCard(session.state, starterMonster.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterMonsterCode}.lua`) return damageCalculationDrawScript();
        if (name === `c${chainResponderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [starterMonsterCode, resonanceCode, chainResponderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    applyNamedAction(session, 0, (action) => action.type === "changePhase" && action.phase === "battle");
    applyNamedAction(session, 0, (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === synchro.uid);
    for (const player of [1, 0, 1, 0, 1, 0, 1] as const) applyNamedAction(session, player, (action) => action.type === "passDamage" || action.type === "passAttack");
    expect(session.state.battleWindow?.kind).toBe("duringDamageCalculation");

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starterMonster.uid);
    expect(starterAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      id: "chain-4",
      operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 }],
      player: 0,
      sourceUid: starterMonster.uid,
    });

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenChain);
    expectRestoredLegalActions(restoredOpenChain, 1);
    const resonanceAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === resonance.uid);
    expect(resonanceAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpenChain, 1), null, 2)).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredOpenChain, resonanceAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredOpenChain.session.state.chain).toHaveLength(0);
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === starterMonster.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === resonance.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === synchro.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === drawn.uid)).toMatchObject({ location: "deck" });
    expect(restoredOpenChain.host.messages).not.toContain("adamancipator monster resolved");
    expect(restoredOpenChain.host.messages).not.toContain("adamancipator chain responder resolved");
    expect(restoredOpenChain.session.state.eventHistory.filter((event) => ["destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: starterMonster.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: resonance.uid,
        eventReasonEffectId: 3,
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
        eventChainLinkId: "chain-4",
        relatedEffectId: 1,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-4",
        relatedEffectId: 1,
      },
    ]);
    expect(restoredOpenChain.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn" && event.eventPlayer === 0 && event.eventUids?.includes(drawn.uid))).toEqual([]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpenChain.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, restoredResolved.session.state.waitingFor ?? restoredResolved.session.state.turnPlayer);
    expect(restoredResolved.session.state.chain).toHaveLength(0);
    expect(restoredResolved.session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    expect(restoredResolved.host.messages).not.toContain("adamancipator monster resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function damageCalculationDrawScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetProperty(EFFECT_FLAG_DAMAGE_CAL)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.IsDamageCalculation() end)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("adamancipator monster resolved")
        Duel.Draw(tp,1,REASON_EFFECT)
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
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>1 end)
      e:SetOperation(function(e,tp) Debug.Message("adamancipator chain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyNamedAction(session: DuelSession, player: 0 | 1, predicate: (action: ReturnType<typeof getLegalActions>[number]) => boolean): void {
  const action = getLegalActions(session, player).find(predicate);
  expect(action, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
  applyAndAssert(session, action!);
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
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
