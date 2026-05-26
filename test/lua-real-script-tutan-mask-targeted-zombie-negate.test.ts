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
const raceZombie = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Tutan Mask targeted Zombie negate", () => {
  it("restores CHAININFO_TARGET_CARDS gating for a single face-up Zombie target, activation negation, destruction, and suppressed Spell operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const tutanCode = "3149764";
    const starterSpellCode = "31497640";
    const drawnCode = "31497641";
    const zombieCode = "31497642";
    const responderCode = "31497643";
    const script = workspace.readScript(`c${tutanCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_NEGATE+CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
    expect(script).toContain("if not re:IsHasProperty(EFFECT_FLAG_CARD_TARGET) then return end");
    expect(script).toContain("local tg=Duel.GetChainInfo(ev,CHAININFO_TARGET_CARDS)");
    expect(script).toContain("return tg and #tg==1 and s.cfilter(tg:GetFirst()) and Duel.IsChainNegatable(ev)");
    expect(script).toContain("return c:IsLocation(LOCATION_MZONE) and c:IsFaceup() and c:IsRace(RACE_ZOMBIE)");
    expect(script).toContain("Duel.NegateActivation(ev)");
    expect(script).toContain("Duel.Destroy(eg,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === tutanCode),
      { code: starterSpellCode, name: "Tutan Targeted Draw Spell", kind: "spell", typeFlags: typeSpell },
      { code: drawnCode, name: "Tutan Suppressed Draw", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: zombieCode, name: "Tutan Face-up Zombie Target", kind: "monster", typeFlags: typeMonster, race: raceZombie, level: 4, attack: 1600, defense: 1200 },
      { code: responderCode, name: "Tutan Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3149764, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterSpellCode, drawnCode, responderCode] }, 1: { main: [tutanCode, zombieCode] } });
    startDuel(session);

    const tutan = requireCard(session, tutanCode);
    const starterSpell = requireCard(session, starterSpellCode);
    const drawn = requireCard(session, drawnCode);
    const zombie = requireCard(session, zombieCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, starterSpell.uid, "spellTrapZone", 0);
    starterSpell.position = "faceDown";
    starterSpell.faceUp = false;
    moveDuelCard(session.state, responder.uid, "hand", 0);
    moveDuelCard(session.state, tutan.uid, "spellTrapZone", 1);
    tutan.position = "faceDown";
    tutan.faceUp = false;
    moveDuelCard(session.state, zombie.uid, "monsterZone", 1);
    zombie.position = "faceUpAttack";
    zombie.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterSpellCode}.lua`) return targetedDrawSpellScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [starterSpellCode, tutanCode, responderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starterSpell.uid);
    expect(starterAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "spellTrapZone",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      id: "chain-2",
      operationInfos: [
        { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 },
      ],
      player: 0,
      sourceUid: starterSpell.uid,
      targetFieldIds: [9],
      targetUids: [zombie.uid],
    });

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenChain);
    expectRestoredLegalActions(restoredOpenChain, 1);
    const tutanAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === tutan.uid);
    expect(tutanAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpenChain, 1), null, 2)).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredOpenChain, tutanAction!);
    expect(chained.ok, chained.error).toBe(true);
    const restoredPendingResolution = restoredOpenChain;

    expect(restoredPendingResolution.session.state.chain).toHaveLength(0);
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === starterSpell.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === tutan.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === zombie.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === drawn.uid)).toMatchObject({ location: "deck" });
    expect(restoredPendingResolution.host.messages).not.toContain("tutan targeted spell resolved");
    expect(restoredPendingResolution.host.messages).not.toContain("tutan chain responder resolved");
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: zombie.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: starterSpell.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: tutan.uid,
        eventReasonEffectId: 3,
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
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn" && event.eventUids?.includes(drawn.uid))).toEqual([]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredPendingResolution.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, restoredResolved.session.state.waitingFor ?? restoredResolved.session.state.turnPlayer);
    expect(restoredResolved.session.state.chain).toHaveLength(0);
    expect(restoredResolved.host.messages).not.toContain("tutan targeted spell resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function targetedDrawSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
        if chkc then return chkc:IsControler(1-tp) and chkc:IsLocation(LOCATION_MZONE) and chkc:IsFaceup() end
        if chk==0 then return Duel.IsExistingTarget(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil) and Duel.IsPlayerCanDraw(tp,1) end
        Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TARGET)
        Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("tutan targeted spell resolved")
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
      e:SetOperation(function(e,tp) Debug.Message("tutan chain responder resolved") end)
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
