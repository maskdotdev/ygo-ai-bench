import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const skullArchfiendCode = "61370518";
const hasSkullArchfiendScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${skullArchfiendCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const setArchfiend = 0x45;

describe.skipIf(!hasUpstreamScripts || !hasSkullArchfiendScript)("Lua real script Skull Archfiend dice target negate", () => {
  it("restores mandatory Standby LP upkeep and dice-gated chain-solving targeted-effect negation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const targetedSpellCode = "613705180";
    const responderCode = "613705181";
    const script = workspace.readScript(`c${skullArchfiendCode}.lua`) ?? "";
    expect(script).toContain("e1:SetCode(EVENT_PHASE|PHASE_STANDBY)");
    expect(script).toContain("Duel.CheckLPCost(tp,500)");
    expect(script).toContain("Duel.PayLPCost(tp,500)");
    expect(script).toContain("Duel.Destroy(e:GetHandler(),REASON_COST)");
    expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVING)");
    expect(script).toContain("Duel.GetChainInfo(ev,CHAININFO_TARGET_CARDS)");
    expect(script).toContain("Duel.IsChainDisablable(ev)");
    expect(script).toContain("Duel.TossDice(tp,1)");
    expect(script).toContain("Duel.NegateEffect(ev)");
    expect(script).toContain("Duel.Destroy(rc,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: skullArchfiendCode, name: "Skull Archfiend of Lightning", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setArchfiend], level: 6, attack: 2500, defense: 1200 },
      { code: targetedSpellCode, name: "Skull Archfiend Targeting Spell", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Skull Archfiend Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [skullArchfiendCode, responderCode] }, 1: { main: [targetedSpellCode] } });
    startDuel(session);

    const skull = requireCard(session, skullArchfiendCode);
    const targetedSpell = requireCard(session, targetedSpellCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, skull.uid, "monsterZone", 0);
    skull.faceUp = true;
    skull.position = "faceUpAttack";
    moveDuelCard(session.state, targetedSpell.uid, "hand", 1);
    moveDuelCard(session.state, responder.uid, "hand", 0);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "draw";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${targetedSpellCode}.lua`) return targetedSpellScript(targetedSpellCode);
        if (name === `c${responderCode}.lua`) return chainResponderScript(responderCode);
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(skullArchfiendCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(targetedSpellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 0);
    const standby = getLuaRestoreLegalActions(restoredDraw, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredDraw, standby!);
    expect(restoredDraw.session.state.pendingTriggers).toEqual([]);
    expect(restoredDraw.session.state.players[0].lifePoints).toBe(7500);
    expect(restoredDraw.session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: skull.uid,
        eventReasonEffectId: 1,
      },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    restoredOpen.session.state.phase = "main1";
    restoredOpen.session.state.turnPlayer = 1;
    restoredOpen.session.state.waitingFor = 1;
    const activation = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === targetedSpell.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain[0]).toEqual({
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-4-1002",
      id: "chain-5",
      operationInfos: [
        {
          category: 4096,
          count: 1,
          parameter: 0,
          player: 0,
          targetUids: [skull.uid],
        },
      ],
      player: 1,
      sourceUid: targetedSpell.uid,
      targetUids: [skull.uid],
    });
    expect(getLuaRestoreLegalActions(restoredOpen, 0).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 0);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("skull archfiend target spell resolved");
    expect(restoredChain.host.messages).not.toContain("skull archfiend responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === skull.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === targetedSpell.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: skull.uid,
      reasonEffectId: 4,
      reasonPlayer: 0,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "diceTossed")).toEqual([
      {
        eventName: "diceTossed",
        eventCode: 1150,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: skull.uid,
        eventReasonEffectId: 4,
      },
    ]);
    expect(restoredChain.session.state.lastDiceResults).toEqual([3]);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "chainNegated")).toEqual([
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-5",
        relatedEffectId: 4,
      },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "chainDisabled")).toEqual([
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-5",
        relatedEffectId: 4,
      },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === targetedSpell.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: targetedSpell.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonCardUid: skull.uid,
        eventReasonEffectId: 4,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
  });
});

function chainResponderScript(code: string): string {
  return `
    c${code}={}
    function c${code}.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("skull archfiend responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function targetedSpellScript(code: string): string {
  return `
    c${code}={}
    function c${code}.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_POSITION)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
        if chkc then return chkc:IsLocation(LOCATION_MZONE) and chkc:IsControler(1-tp) and chkc:IsFaceup() end
        if chk==0 then return Duel.IsExistingTarget(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil) end
        Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_FACEUP)
        local g=Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)
        Duel.SetOperationInfo(0,CATEGORY_POSITION,g,1,0,0)
      end)
      e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("skull archfiend target spell resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
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
    applyLuaRestoreAndAssert(restored, pass as DuelAction);
  }
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
