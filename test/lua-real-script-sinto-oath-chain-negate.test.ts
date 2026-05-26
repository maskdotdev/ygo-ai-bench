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
const typeTrap = 0x4;
const setFireFist = 0x79;
const setFireFormation = 0x7c;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ultimate Fire Formation - Sinto OATH negate", () => {
  it("restores its Fire Fist and Fire Formation gate, OATH activation negation, source destruction, and suppressed Spell operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sintoCode = "55538156";
    const firstSpellCode = "555381560";
    const secondSpellCode = "555381561";
    const firstDrawnCode = "555381562";
    const secondDrawnCode = "555381563";
    const fireFistCode = "555381564";
    const fireFormationCode = "555381565";
    const responderCode = "555381566";
    const oathProbeResponderCode = "555381567";
    const script = workspace.readScript(`c${sintoCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_NEGATE+CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
    expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_FIRE_FIST) and c:IsMonster()");
    expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_FIRE_FORMATION) and (c:IsSpell() or c:IsTrap())");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.filter1,tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.filter2,tp,LOCATION_SZONE,0,1,nil)");
    expect(script).toContain("Duel.NegateActivation(ev)");
    expect(script).toContain("Duel.Destroy(eg,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sintoCode),
      { code: firstSpellCode, name: "Sinto First Suppressed Spell", kind: "spell", typeFlags: typeSpell },
      { code: secondSpellCode, name: "Sinto Second Spell", kind: "spell", typeFlags: typeSpell },
      { code: firstDrawnCode, name: "Sinto First Suppressed Draw", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: secondDrawnCode, name: "Sinto Second Draw", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: fireFistCode, name: "Sinto Fire Fist Gate", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000, setcodes: [setFireFist] },
      { code: fireFormationCode, name: "Sinto Fire Formation Gate", kind: "spell", typeFlags: typeSpell, setcodes: [setFireFormation] },
      { code: responderCode, name: "Sinto Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: oathProbeResponderCode, name: "Sinto OATH Probe Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 55538156, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [firstSpellCode, secondSpellCode, firstDrawnCode, secondDrawnCode, responderCode] },
      1: { main: [sintoCode, sintoCode, fireFistCode, fireFormationCode, oathProbeResponderCode] },
    });
    startDuel(session);

    const [firstSinto, secondSinto] = session.state.cards.filter((card) => card.code === sintoCode).sort((a, b) => a.uid.localeCompare(b.uid));
    expect(firstSinto).toBeDefined();
    expect(secondSinto).toBeDefined();
    const firstSpell = requireCard(session, firstSpellCode);
    const secondSpell = requireCard(session, secondSpellCode);
    const firstDrawn = requireCard(session, firstDrawnCode);
    const secondDrawn = requireCard(session, secondDrawnCode);
    const responder = requireCard(session, responderCode);
    const oathProbeResponder = requireCard(session, oathProbeResponderCode);
    const fireFist = requireCard(session, fireFistCode);
    const fireFormation = requireCard(session, fireFormationCode);
    moveDuelCard(session.state, firstSpell.uid, "spellTrapZone", 0);
    firstSpell.position = "faceDown";
    firstSpell.faceUp = false;
    moveDuelCard(session.state, secondSpell.uid, "spellTrapZone", 0);
    secondSpell.position = "faceDown";
    secondSpell.faceUp = false;
    moveDuelCard(session.state, firstSinto!.uid, "spellTrapZone", 1);
    firstSinto!.position = "faceDown";
    firstSinto!.faceUp = false;
    moveDuelCard(session.state, secondSinto!.uid, "spellTrapZone", 1);
    secondSinto!.position = "faceDown";
    secondSinto!.faceUp = false;
    moveDuelCard(session.state, fireFist.uid, "monsterZone", 1);
    fireFist.position = "faceUpAttack";
    fireFist.faceUp = true;
    moveDuelCard(session.state, fireFormation.uid, "spellTrapZone", 1);
    fireFormation.position = "faceUpAttack";
    fireFormation.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 0);
    moveDuelCard(session.state, oathProbeResponder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${firstSpellCode}.lua`) return spellDrawScript("sinto first spell resolved");
        if (name === `c${secondSpellCode}.lua`) return spellDrawScript("sinto second spell resolved");
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        if (name === `c${oathProbeResponderCode}.lua`) return oathProbeResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [firstSpellCode, secondSpellCode, sintoCode, responderCode, oathProbeResponderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(6);

    const firstAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === firstSpell.uid);
    expect(firstAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, firstAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "spellTrapZone",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      id: "chain-2",
      operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 }],
      player: 0,
      sourceUid: firstSpell.uid,
    });

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenChain);
    expectRestoredLegalActions(restoredOpenChain, 1);
    const sintoAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === firstSinto!.uid);
    expect(sintoAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpenChain, 1), null, 2)).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredOpenChain, sintoAction!);
    expect(chained.ok, chained.error).toBe(true);
    const restoredPendingResolution = restoredOpenChain;

    expect(restoredPendingResolution.session.state.chain).toHaveLength(0);
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === firstSpell.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === firstSinto!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === secondSinto!.uid)).toMatchObject({ location: "spellTrapZone", controller: 1 });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === fireFist.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === fireFormation.uid)).toMatchObject({ location: "spellTrapZone", faceUp: true });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === firstDrawn.uid)).toMatchObject({ location: "deck" });
    expect(restoredPendingResolution.host.messages).not.toContain("sinto first spell resolved");
    expect(restoredPendingResolution.host.messages).not.toContain("sinto chain responder resolved");
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: firstSpell.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: firstSinto!.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
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
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn" && event.eventUids?.includes(firstDrawn.uid))).toEqual([]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredPendingResolution.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    const secondAction = getLuaRestoreLegalActions(restoredResolved, 0).find((action) => action.type === "activateEffect" && action.uid === secondSpell.uid);
    expect(secondAction, JSON.stringify(getLuaRestoreLegalActions(restoredResolved, 0), null, 2)).toBeDefined();
    const secondActivated = applyLuaRestoreResponse(restoredResolved, secondAction!);
    expect(secondActivated.ok, secondActivated.error).toBe(true);
    expect(restoredResolved.session.state.chain).toHaveLength(1);
    const restoredSecondOpenChain = restoreDuelWithLuaScripts(serializeDuel(restoredResolved.session), source, reader);
    expectCleanRestore(restoredSecondOpenChain);
    expectRestoredLegalActions(restoredSecondOpenChain, 1);
    expect(getLuaRestoreLegalActions(restoredSecondOpenChain, 1).some((action) => action.type === "activateEffect" && action.uid === secondSinto!.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredSecondOpenChain, 1).some((action) => action.type === "activateEffect" && action.uid === oathProbeResponder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredSecondOpenChain, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const secondResolved = applyLuaRestoreResponse(restoredSecondOpenChain, pass!);
    expect(secondResolved.ok, secondResolved.error).toBe(true);
    expect(restoredSecondOpenChain.host.messages).toContain("sinto second spell resolved");
    expect(restoredSecondOpenChain.session.state.cards.find((card) => card.uid === secondDrawn.uid)).toMatchObject({ location: "hand", controller: 0 });
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function spellDrawScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("${message}")
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
      e:SetOperation(function(e,tp) Debug.Message("sinto chain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function oathProbeResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("sinto oath probe responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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
