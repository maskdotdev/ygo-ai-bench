import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const eventChainSolving = 1020;

describe.skipIf(!hasUpstreamScripts)("Lua real script Gora Turtle targeted Spell negate", () => {
  it("restores Double Snare validity and chain-solving targeted Spell negation with handler destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const goraCode = "42868711";
    const targetedSpellCode = "42868712";
    const responderCode = "42868713";
    const script = workspace.readScript(`c${goraCode}.lua`) ?? "";
    expect(script).toContain("aux.DoubleSnareValidity(c,LOCATION_MZONE)");
    expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVING)");
    expect(script).toContain("Duel.GetChainInfo(ev,CHAININFO_TARGET_CARDS)");
    expect(script).toContain("Duel.NegateEffect(ev)");
    expect(script).toContain("Duel.Destroy(re:GetHandler(),REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: goraCode, name: "Gora Turtle of Illusion", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1400 },
      { code: targetedSpellCode, name: "Gora Turtle Targeting Spell", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Gora Turtle Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4286, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [goraCode, responderCode] }, 1: { main: [targetedSpellCode] } });
    startDuel(session);

    const gora = session.state.cards.find((card) => card.code === goraCode);
    const targetedSpell = session.state.cards.find((card) => card.code === targetedSpellCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(gora).toBeDefined();
    expect(targetedSpell).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, gora!.uid, "monsterZone", 0);
    gora!.faceUp = true;
    gora!.position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, targetedSpell!.uid, "hand", 1);
    session.state.turn = 2;
    session.state.turnPlayer = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${targetedSpellCode}.lua`) return targetedSpellScript(targetedSpellCode);
        if (name === `c${responderCode}.lua`) return chainResponderScript(responderCode);
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(goraCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(targetedSpellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === gora!.uid)).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 2,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-1-2",
          "luaTypeFlags": 2,
          "oncePerTurn": false,
          "operation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:42868711:lua-1-2",
          "sourceUid": "p0-deck-42868711-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "targetRange": [
            8,
            8,
          ],
        },
        {
          "canActivate": [Function],
          "code": 1020,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-1020",
          "luaTypeFlags": 2050,
          "oncePerTurn": false,
          "operation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:42868711:lua-2-1020",
          "sourceUid": "p0-deck-42868711-0",
          "target": [Function],
        },
        {
          "canActivate": [Function],
          "code": 141,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-3-141",
          "luaTypeFlags": 2,
          "oncePerTurn": false,
          "operation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:42868711:lua-3-141",
          "sourceUid": "p0-deck-42868711-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "targetRange": [
            8,
            8,
          ],
        },
        {
          "canActivate": [Function],
          "code": 3682106,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-4-3682106",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 132096,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:42868711:lua-4-3682106",
          "sourceUid": "p0-deck-42868711-0",
          "target": [Function],
        },
      ]
    `);

    const activation = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === targetedSpell!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-6-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 4096,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-42868711-0",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-42868712-0",
        "targetFieldIds": [
          4,
        ],
        "targetUids": [
          "p0-deck-42868711-0",
        ],
      }
    `);
    expect(getLuaRestoreLegalActions(restoredOpen, 0).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 0);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.host.messages).not.toContain("gora targeting spell resolved");
    expect(restoredChain.host.messages).not.toContain("gora responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === gora!.uid)).toMatchObject({
      location: "monsterZone",
      faceUp: true,
      position: "faceUpAttack",
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === targetedSpell!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: gora!.uid,
      reasonEffectId: 6,
      reasonPlayer: 0,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "chainNegated")).toEqual([
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 6,
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
        eventChainLinkId: "chain-2",
        relatedEffectId: 6,
      },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === targetedSpell!.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: targetedSpell!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonCardUid: gora!.uid,
        eventReasonEffectId: 6,
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
      e:SetOperation(function(e,tp) Debug.Message("gora responder resolved") end)
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
        Debug.Message("gora targeting spell resolved")
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
