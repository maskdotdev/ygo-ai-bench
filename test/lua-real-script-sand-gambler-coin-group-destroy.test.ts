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
const sandGamblerCode = "50593156";
const allyCode = "505931560";
const opponentACode = "505931561";
const opponentBCode = "505931562";
const hasSandGamblerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sandGamblerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryCoin = 0x1000000;
const categoryDestroy = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasSandGamblerScript)("Lua real script Sand Gambler coin group destroy", () => {
  it("restores three-head TossCoin into opponent monster group destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${sandGamblerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sandGamblerCode, allyCode] }, 1: { main: [opponentACode, opponentBCode] } });
    startDuel(session);

    const sandGambler = requireCard(session, sandGamblerCode);
    const ally = requireCard(session, allyCode);
    const opponentA = requireCard(session, opponentACode);
    const opponentB = requireCard(session, opponentBCode);
    moveFaceUpAttack(session, sandGambler, 0, 0);
    moveFaceUpAttack(session, ally, 0, 1);
    moveFaceUpAttack(session, opponentA, 1, 0);
    moveFaceUpAttack(session, opponentB, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sandGamblerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === sandGambler.uid).map((effect) => ({
      category: effect.category,
      event: effect.event,
      range: effect.range,
    }))).toEqual([
      { category: categoryCoin | categoryDestroy, event: "ignition", range: ["monsterZone"] },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === sandGambler.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);

    expect(restoredOpen.session.state.lastCoinResults).toEqual([1, 1, 1]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === sandGambler.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ally.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    for (const opponent of [opponentA, opponentB]) {
      expect(restoredOpen.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({
        location: "graveyard",
        controller: 1,
        reason: duelReason.destroy | duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: sandGambler.uid,
        reasonEffectId: 1,
      });
    }
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["coinTossed", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 3,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: sandGambler.uid,
        eventReasonEffectId: 1,
      },
      destroyedEvent(opponentA.uid, sandGambler.uid, 0),
      destroyedEvent(opponentB.uid, sandGambler.uid, 1),
      {
        ...destroyedEvent(opponentA.uid, sandGambler.uid, 0),
        eventUids: [opponentA.uid, opponentB.uid],
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Sand Gambler");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN+CATEGORY_DESTROY)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("local g=Duel.GetMatchingGroup(nil,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,3)");
  expect(script).toContain("local c1,c2,c3=Duel.TossCoin(tp,3)");
  expect(script).toContain("if Duel.CountHeads(c1,c2,c3)==3 then");
  expect(script).toContain("Duel.GetMatchingGroup(nil,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("elseif Duel.CountTails(c1,c2,c3)==3 then");
  expect(script).toContain("Duel.GetMatchingGroup(nil,tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: sandGamblerCode, name: "Sand Gambler", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 300, defense: 1600 },
    { code: allyCode, name: "Sand Gambler Ally", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: opponentACode, name: "Sand Gambler Opponent A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1100, defense: 1000 },
    { code: opponentBCode, name: "Sand Gambler Opponent B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
  ];
}

function destroyedEvent(cardUid: string, sourceUid: string, sequence: number) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventReason: duelReason.destroy | duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence },
    eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence },
  };
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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
