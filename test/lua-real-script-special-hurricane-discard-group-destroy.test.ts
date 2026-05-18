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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Special Hurricane discard group destroy", () => {
  it("restores Special Hurricane's discard cost and non-targeting Special Summoned group destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const hurricaneCode = "42598242";
    const discardCode = "42598243";
    const ownSpecialCode = "42598244";
    const opponentSpecialCode = "42598245";
    const normalSurvivorCode = "42598246";
    const responderCode = "42598247";
    const script = workspace.readScript(`c${hurricaneCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)");
    expect(script).toContain("return c:IsSpecialSummoned()");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)");
    expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === hurricaneCode),
      { code: discardCode, name: "Special Hurricane Discard Cost", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: ownSpecialCode, name: "Special Hurricane Own Special", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200 },
      { code: opponentSpecialCode, name: "Special Hurricane Opponent Special", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
      { code: normalSurvivorCode, name: "Special Hurricane Normal Survivor", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1400 },
      { code: responderCode, name: "Special Hurricane Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 42598242, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hurricaneCode, discardCode, ownSpecialCode, normalSurvivorCode] }, 1: { main: [opponentSpecialCode, responderCode] } });
    startDuel(session);

    const hurricane = requireCard(session, hurricaneCode);
    const discard = requireCard(session, discardCode);
    const ownSpecial = requireCard(session, ownSpecialCode);
    const opponentSpecial = requireCard(session, opponentSpecialCode);
    const normalSurvivor = requireCard(session, normalSurvivorCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, hurricane.uid, "hand", 0);
    moveDuelCard(session.state, discard.uid, "hand", 0);
    const movedOwnSpecial = moveDuelCard(session.state, ownSpecial.uid, "monsterZone", 0);
    movedOwnSpecial.position = "faceUpAttack";
    movedOwnSpecial.sequence = 0;
    movedOwnSpecial.summonType = "special";
    const movedNormalSurvivor = moveDuelCard(session.state, normalSurvivor.uid, "monsterZone", 0);
    movedNormalSurvivor.position = "faceUpAttack";
    movedNormalSurvivor.sequence = 1;
    movedNormalSurvivor.summonType = "normal";
    const movedOpponentSpecial = moveDuelCard(session.state, opponentSpecial.uid, "monsterZone", 1);
    movedOpponentSpecial.position = "faceUpAttack";
    movedOpponentSpecial.sequence = 0;
    movedOpponentSpecial.summonType = "special";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hurricaneCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === hurricane.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    const discardEvent = {
      eventName: "discarded",
      eventCode: 1018,
      eventCardUid: discard.uid,
      eventReason: duelReason.cost | duelReason.discard,
      eventReasonPlayer: 0,
      eventReasonCardUid: hurricane.uid,
      eventReasonEffectId: 1,
      eventPreviousState: { controller: 0, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
      eventCurrentState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
    };
    expect(session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.eventHistory.filter((event) => event.eventName === "discarded")).toEqual([discardEvent]);
    expect(session.state.chain).toMatchInlineSnapshot(`
      [
        {
          "activationLocation": "hand",
          "activationSequence": 0,
          "chainIndex": 1,
          "effectId": "lua-1-1002",
          "id": "chain-3",
          "operationInfos": [
            {
              "category": 1,
              "count": 2,
              "parameter": 0,
              "player": 0,
              "targetUids": [
                "p0-deck-42598244-2",
                "p1-deck-42598245-0",
              ],
            },
          ],
          "player": 0,
          "sourceUid": "p0-deck-42598242-0",
        },
      ]
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [ownSpecial.uid, opponentSpecial.uid], count: 2, player: 0, parameter: 0 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "discarded")).toEqual([discardEvent]);
    expectRestoredLegalActions(restored, 1);
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    expect(restored.session.state.chain).toEqual(session.state.chain);
    passChain(restored);

    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === hurricane.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === ownSpecial.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentSpecial.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === normalSurvivor.uid)).toMatchObject({ location: "monsterZone", controller: 0, sequence: 1 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownSpecial.uid,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 1,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: hurricane.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentSpecial.uid,
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
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: hurricane.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownSpecial.uid,
        eventUids: [ownSpecial.uid, opponentSpecial.uid],
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 1,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: hurricane.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(host.messages).not.toContain("special hurricane responder resolved");
    expect(restored.host.messages).not.toContain("special hurricane responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("special hurricane responder resolved") end)
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
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  if (response.state.waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    if (restored.session.state.waitingFor !== undefined) {
      expect(resolved.legalActions).toEqual(getLuaRestoreLegalActions(restored, restored.session.state.waitingFor));
      expect(resolved.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, restored.session.state.waitingFor));
      expect(resolved.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolved.legalActions);
    }
  }
}
