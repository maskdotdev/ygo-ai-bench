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
const calamityCaesarCode = "80738884";
const starterCode = "807388840";
const vanquishSoulCode = "807388841";
const responderCode = "807388842";
const setVanquishSoul = 0x196;
const typeMonster = 0x1;
const typeSpell = 0x2;
const promptOverrides = [{ api: "SelectYesNo" as const, player: 0 as const, returned: true }];

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Vanquish Soul Calamity Caesar negate burn", () => {
  it("restores targeted opponent-chain negation, OATH source destruction, selected Vanquish Soul damage, and suppressed operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${calamityCaesarCode}.lua`);
    expectScriptShape(script);
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === calamityCaesarCode),
      { code: starterCode, name: "Calamity Caesar Targeting Starter", kind: "spell", typeFlags: typeSpell },
      { code: vanquishSoulCode, name: "Calamity Caesar Face-up Vanquish Soul", kind: "monster", typeFlags: typeMonster, setcodes: [setVanquishSoul], level: 4, attack: 1900, defense: 1000 },
      { code: responderCode, name: "Calamity Caesar Followup Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 80738884, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [calamityCaesarCode, vanquishSoulCode, responderCode] }, 1: { main: [starterCode] } });
    startDuel(session);

    const calamityCaesar = requireCard(session, calamityCaesarCode);
    const starter = requireCard(session, starterCode);
    const vanquishSoul = requireCard(session, vanquishSoulCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, calamityCaesar.uid, "spellTrapZone", 0);
    calamityCaesar.position = "faceDown";
    calamityCaesar.faceUp = false;
    moveFaceUpAttack(session, vanquishSoul, 0);
    moveDuelCard(session.state, responder.uid, "hand", 0);
    moveDuelCard(session.state, starter.uid, "hand", 1);
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return targetingDestroySpellScript(vanquishSoulCode);
        if (name === `c${responderCode}.lua`) return followupScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    for (const code of [calamityCaesarCode, starterCode, responderCode]) {
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
        operationInfos: [{ category: 0x1, targetUids: [vanquishSoul.uid], count: 1, player: 0, parameter: 0x4 }],
        targetUids: [vanquishSoul.uid],
      },
    ]);

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, { promptOverrides });
    expectCleanRestore(restoredOpenChain);
    expectRestoredLegalActions(restoredOpenChain, 0);
    const caesarAction = getLuaRestoreLegalActions(restoredOpenChain, 0).find((action) => action.type === "activateEffect" && action.uid === calamityCaesar.uid);
    expect(caesarAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpenChain, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpenChain, caesarAction!);
    expect(restoredOpenChain.session.state.chain).toHaveLength(0);
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === calamityCaesar.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: calamityCaesar.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === vanquishSoul.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(restoredOpenChain.session.state.players[1].lifePoints).toBe(6100);
    expect(restoredOpenChain.host.promptDecisions).toContainEqual({ id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 1291822145, returned: true });
    expect(restoredOpenChain.host.messages).not.toContain("calamity caesar targeting starter resolved");
    expect(restoredOpenChain.host.messages).not.toContain("calamity caesar followup resolved");
    expect(restoredOpenChain.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "damageDealt", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: vanquishSoul.uid,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventValue: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: starter.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: calamityCaesar.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1900,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: calamityCaesar.uid,
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
  expect(script).toContain("--Vanquish Soul Calamity Caesar");
  expect(script).toContain("e1:SetCategory(CATEGORY_NEGATE+CATEGORY_DESTROY+CATEGORY_DAMAGE)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("aux.FaceupFilter(Card.IsSetCard,SET_VANQUISH_SOUL)");
  expect(script).toContain("if not re:IsHasProperty(EFFECT_FLAG_CARD_TARGET) then return false end");
  expect(script).toContain("local tg=Duel.GetChainInfo(ev,CHAININFO_TARGET_CARDS)");
  expect(script).toContain("return tg and tg:IsExists(s.filter,1,nil,tp) and Duel.IsChainNegatable(ev)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,0)");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("Duel.Destroy(eg,REASON_EFFECT)>0");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,1))");
  expect(script).toContain("Duel.HintSelection(tc,true)");
  expect(script).toContain("Duel.Damage(1-tp,dam,REASON_EFFECT)");
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
          Debug.Message("calamity caesar targeting starter resolved")
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
      e:SetOperation(function(e,tp) Debug.Message("calamity caesar followup resolved") end)
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
