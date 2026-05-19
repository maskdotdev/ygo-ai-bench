import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamScriptSource = hasUpstreamScripts;
const keyCode = "69320362";
const firstWindUpCode = "693203620";
const secondWindUpCode = "693203621";
const offSetCode = "693203622";
const responderCode = "693203623";
const setWindUp = 0x58;
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamScriptSource)("Lua real script Legendary Wind-Up Key group set", () => {
  it("restores free-chain Wind-Up group turn-set operation info and grouped position changes", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${keyCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_POSITION+CATEGORY_SET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_WIND_UP) and c:IsCanTurnSet()");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,0,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_POSITION,g,#g,tp,POS_FACEDOWN_DEFENSE)");
    expect(script).toContain("Duel.ChangePosition(g,POS_FACEDOWN_DEFENSE)");

    const cards: DuelCardData[] = [
      { code: keyCode, name: "Legendary Wind-Up Key", kind: "spell", typeFlags: 0x2 },
      { code: firstWindUpCode, name: "Legendary Key First Wind-Up", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setWindUp], level: 4, attack: 1700, defense: 1200 },
      { code: secondWindUpCode, name: "Legendary Key Second Wind-Up", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setWindUp], level: 4, attack: 1500, defense: 1500 },
      { code: offSetCode, name: "Legendary Key Non-Wind-Up Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
      { code: responderCode, name: "Legendary Key Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 69320362, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [keyCode, firstWindUpCode, secondWindUpCode, offSetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const key = requireCard(session, keyCode);
    const first = requireCard(session, firstWindUpCode);
    const second = requireCard(session, secondWindUpCode);
    const offSet = requireCard(session, offSetCode);
    const responder = requireCard(session, responderCode);
    const movedKey = moveDuelCard(session.state, key.uid, "spellTrapZone", 0);
    movedKey.position = "faceDown";
    movedKey.faceUp = false;
    for (const card of [first, second, offSet]) {
      const moved = moveDuelCard(session.state, card.uid, "monsterZone", 0);
      moved.position = "faceUpAttack";
      moved.faceUp = true;
      moved.turnId = 0;
    }
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(keyCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === key.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, action!);
    const targetUids = [first.uid, second.uid];
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: key.uid,
        player: 0,
        effectId: "lua-1-1002",
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        operationInfos: [{ category: 0x1000, targetUids, count: 2, player: 0, parameter: 0x8 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((candidate) => candidate.type === "activateEffect" && candidate.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredChain, pass!);

    expect(restoredChain.session.state.chain).toEqual([]);
    expect(restoredChain.session.state.cards.find((card) => card.uid === key.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === first.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceDownDefense", faceUp: false });
    expect(restoredChain.session.state.cards.find((card) => card.uid === second.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceDownDefense", faceUp: false });
    expect(restoredChain.session.state.cards.find((card) => card.uid === offSet.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true });
    expect(restoredChain.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChain.host.messages).not.toContain("legendary key responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "positionChanged")).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: first.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: key.uid,
        eventReasonEffectId: 1,
        eventPreviousState: cardState(0, true, "monsterZone", "faceUpAttack", 0),
        eventCurrentState: cardState(0, false, "monsterZone", "faceDownDefense", 0),
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: second.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: key.uid,
        eventReasonEffectId: 1,
        eventPreviousState: cardState(0, true, "monsterZone", "faceUpAttack", 1),
        eventCurrentState: cardState(0, false, "monsterZone", "faceDownDefense", 1),
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: first.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: key.uid,
        eventReasonEffectId: 1,
        eventUids: targetUids,
        eventPreviousState: cardState(0, true, "monsterZone", "faceUpAttack", 0),
        eventCurrentState: cardState(0, false, "monsterZone", "faceDownDefense", 0),
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function cardState(controller: PlayerId, faceUp: boolean, location: string, position: string, sequence: number) {
  return { controller, faceUp, location, position, sequence };
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
      e:SetOperation(function(e,tp) Debug.Message("legendary key responder resolved") end)
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
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = result.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
