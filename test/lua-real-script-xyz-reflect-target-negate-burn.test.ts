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
const xyzReflectCode = "2371506";
const starterCode = "23715060";
const xyzTargetCode = "23715061";
const responderCode = "23715062";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Xyz Reflect target negate burn", () => {
  it("restores targeted Xyz chain response negation, source destruction, BreakEffect damage, and suppressed operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${xyzReflectCode}.lua`);
    expectScriptShape(script);
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === xyzReflectCode),
      { code: starterCode, name: "Xyz Reflect Targeting Starter", kind: "spell", typeFlags: typeSpell },
      { code: xyzTargetCode, name: "Xyz Reflect Face-up Xyz Target", kind: "extra", typeFlags: typeMonster | typeXyz, level: 4, attack: 2400, defense: 1800 },
      { code: responderCode, name: "Xyz Reflect Followup Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2371506, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [xyzReflectCode, responderCode], extra: [xyzTargetCode] }, 1: { main: [starterCode] } });
    startDuel(session);

    const xyzReflect = requireCard(session, xyzReflectCode);
    const starter = requireCard(session, starterCode);
    const xyzTarget = requireCard(session, xyzTargetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, xyzReflect.uid, "spellTrapZone", 0);
    xyzReflect.position = "faceDown";
    xyzReflect.faceUp = false;
    moveFaceUpAttack(session, xyzTarget, 0);
    moveDuelCard(session.state, responder.uid, "hand", 0);
    moveDuelCard(session.state, starter.uid, "hand", 1);
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return targetingDestroySpellScript(xyzTargetCode);
        if (name === `c${responderCode}.lua`) return followupScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [xyzReflectCode, starterCode, responderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-3-1002",
        sourceUid: starter.uid,
        player: 1,
        activationLocation: "hand",
        activationSequence: 0,
        targetFieldIds: [6],
        operationInfos: [{ category: 0x1, targetUids: [xyzTarget.uid], count: 1, player: 0, parameter: 0x4 }],
        targetUids: [xyzTarget.uid],
      },
    ]);

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenChain);
    expectRestoredLegalActions(restoredOpenChain, 0);
    const reflectAction = getLuaRestoreLegalActions(restoredOpenChain, 0).find((action) => action.type === "activateEffect" && action.uid === xyzReflect.uid);
    expect(reflectAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpenChain, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpenChain, reflectAction!);
    expect(restoredOpenChain.session.state.chain).toHaveLength(0);
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === xyzReflect.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: xyzReflect.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === xyzTarget.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(restoredOpenChain.session.state.players[1].lifePoints).toBe(7200);
    expect(restoredOpenChain.host.messages).not.toContain("xyz reflect targeting starter resolved");
    expect(restoredOpenChain.host.messages).not.toContain("xyz reflect followup resolved");
    expect(restoredOpenChain.session.state.eventHistory.filter((event) => ["becameTarget", "chainNegated", "chainDisabled", "destroyed", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: xyzTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: starter.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: xyzReflect.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: xyzReflect.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Xyz Reflect");
  expect(script).toContain("e1:SetCategory(CATEGORY_NEGATE+CATEGORY_DESTROY+CATEGORY_DAMAGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_CHAINING)");
  expect(script).toContain("if not re:IsHasProperty(EFFECT_FLAG_CARD_TARGET) then return end");
  expect(script).toContain("local tg=Duel.GetChainInfo(ev,CHAININFO_TARGET_CARDS)");
  expect(script).toContain("return tg and tg:IsExists(s.cfilter,1,nil) and Duel.IsChainNegatable(ev)");
  expect(script).toContain("return c:IsLocation(LOCATION_MZONE) and c:IsFaceup() and c:IsType(TYPE_XYZ)");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("Duel.Destroy(eg,REASON_EFFECT)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Damage(1-tp,800,REASON_EFFECT)");
}

function targetingDestroySpellScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
        if chkc then return chkc:IsControler(1-tp) and chkc:IsLocation(LOCATION_MZONE) and chkc:IsCode(${targetCode}) end
        if chk==0 then return Duel.IsExistingTarget(Card.IsCode,tp,0,LOCATION_MZONE,1,nil,${targetCode}) end
        Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TARGET)
        local g=Duel.SelectTarget(tp,Card.IsCode,tp,0,LOCATION_MZONE,1,1,nil,${targetCode})
        Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,1-tp,LOCATION_MZONE)
      end)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstTarget()
        if tc and tc:IsRelateToEffect(e) then
          Debug.Message("xyz reflect targeting starter resolved")
          Duel.Destroy(tc,REASON_EFFECT)
        end
      end)
      c:RegisterEffect(e)
    end
  `;
}

function followupScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>1 end)
      e:SetOperation(function(e,tp) Debug.Message("xyz reflect followup resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.position = "faceUpAttack";
  moved.faceUp = true;
  return moved;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
