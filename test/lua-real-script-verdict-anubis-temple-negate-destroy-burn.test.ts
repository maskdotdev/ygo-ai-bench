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
const verdictCode = "59576447";
const templeCode = "29762407";
const starterCode = "595764470";
const fillerSpellCode = "595764471";
const fillerTrapCode = "595764472";
const firstMonsterCode = "595764473";
const secondMonsterCode = "595764474";
const responderCode = "595764475";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const promptOverrides = [{ api: "SelectYesNo" as const, player: 0 as const, returned: true }];

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Verdict of Anubis Temple negate destroy burn", () => {
  it("restores Temple-gated activation negation into opponent monster destruction, operated-group base ATK damage, and suppressed Spell", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${verdictCode}.lua`);
    expectScriptShape(script);
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === verdictCode || card.code === templeCode),
      { code: starterCode, name: "Verdict of Anubis Starter Spell", kind: "spell", typeFlags: typeSpell },
      { code: fillerSpellCode, name: "Verdict Field Filler Spell", kind: "spell", typeFlags: typeSpell },
      { code: fillerTrapCode, name: "Verdict Field Filler Trap", kind: "trap", typeFlags: typeTrap },
      { code: firstMonsterCode, name: "Verdict First Opponent Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
      { code: secondMonsterCode, name: "Verdict Second Opponent Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 800, defense: 1000 },
      { code: responderCode, name: "Verdict Followup Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 59576447, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [verdictCode, templeCode, fillerSpellCode, fillerTrapCode, responderCode] },
      1: { main: [starterCode, firstMonsterCode, secondMonsterCode] },
    });
    startDuel(session);

    const verdict = requireCard(session, verdictCode);
    const temple = requireCard(session, templeCode);
    const fillerSpell = requireCard(session, fillerSpellCode);
    const fillerTrap = requireCard(session, fillerTrapCode);
    const starter = requireCard(session, starterCode);
    const firstMonster = requireCard(session, firstMonsterCode);
    const secondMonster = requireCard(session, secondMonsterCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, verdict.uid, "spellTrapZone", 0);
    verdict.position = "faceDown";
    verdict.faceUp = false;
    moveDuelCard(session.state, temple.uid, "spellTrapZone", 0);
    temple.sequence = 1;
    temple.position = "faceUpAttack";
    temple.faceUp = true;
    moveDuelCard(session.state, fillerSpell.uid, "spellTrapZone", 0);
    fillerSpell.sequence = 2;
    fillerSpell.position = "faceUpAttack";
    fillerSpell.faceUp = true;
    moveDuelCard(session.state, fillerTrap.uid, "spellTrapZone", 0);
    fillerTrap.sequence = 3;
    fillerTrap.position = "faceUpAttack";
    fillerTrap.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 0);
    moveDuelCard(session.state, starter.uid, "hand", 1);
    moveFaceUpAttack(session, firstMonster, 1).sequence = 0;
    moveFaceUpAttack(session, secondMonster, 1).sequence = 1;
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return starterSpellScript();
        if (name === `c${responderCode}.lua`) return followupScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    for (const code of [verdictCode, starterCode, responderCode]) {
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
        operationInfos: [{ category: 0x80000, targetUids: [], count: 0, player: 0, parameter: 300 }],
      },
    ]);

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, { promptOverrides });
    expectCleanRestore(restoredOpenChain);
    expectRestoredLegalActions(restoredOpenChain, 0);
    const verdictAction = getLuaRestoreLegalActions(restoredOpenChain, 0).find((action) => action.type === "activateEffect" && action.uid === verdict.uid);
    expect(verdictAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpenChain, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpenChain, verdictAction!);
    expect(restoredOpenChain.session.state.chain).toHaveLength(0);
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === verdict.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: verdict.uid,
      reasonEffectId: 1,
    });
    for (const monster of [firstMonster, secondMonster]) {
      expect(restoredOpenChain.session.state.cards.find((card) => card.uid === monster.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.effect | duelReason.destroy,
        reasonPlayer: 0,
        reasonCardUid: verdict.uid,
        reasonEffectId: 1,
      });
    }
    expect(restoredOpenChain.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredOpenChain.host.promptDecisions).toContainEqual({ id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 953223153, returned: true });
    expect(restoredOpenChain.host.messages).not.toContain("verdict starter spell resolved");
    expect(restoredOpenChain.host.messages).not.toContain("verdict followup resolved");
    expect(restoredOpenChain.session.state.eventHistory.filter((event) => ["destroyed", "damageDealt", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: starter.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: verdict.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: firstMonster.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: verdict.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: secondMonster.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: verdict.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 2 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: firstMonster.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: verdict.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
        eventUids: [firstMonster.uid, secondMonster.uid],
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: verdict.uid,
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
  expect(script).toContain("--Verdict of Anubis");
  expect(script).toContain("e1:SetCategory(CATEGORY_NEGATE+CATEGORY_DESTROY+CATEGORY_DAMAGE)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsSpellTrap,tp,LOCATION_ONFIELD,0,3,e:GetHandler())");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("Duel.Destroy(eg,REASON_EFFECT)>0");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,CARD_TEMPLE_OF_THE_KINGS),tp,LOCATION_ONFIELD,0,1,nil)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsMonster,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,1))");
  expect(script).toContain("Duel.GetOperatedGroup():GetSum(Card.GetBaseAttack)/2");
  expect(script).toContain("Duel.Damage(1-tp,dam,REASON_EFFECT)");
}

function starterSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DAMAGE)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,300)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("verdict starter spell resolved")
        Duel.Damage(1-tp,300,REASON_EFFECT)
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
      e:SetOperation(function(e,tp) Debug.Message("verdict followup resolved") end)
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
