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
const gatlingCode = "87751584";
const allyCode = "877515840";
const opponentCode = "877515841";
const hasGatlingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gatlingCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const categoryCoin = 0x1000000;
const categoryDestroy = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasGatlingScript)("Lua real script Gatling Dragon coin group destroy", () => {
  it("restores three-head TossCoin into capped selected monster group destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gatlingCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [gatlingCode], main: [allyCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const gatling = requireCard(session, gatlingCode);
    const ally = requireCard(session, allyCode);
    const opponent = requireCard(session, opponentCode);
    moveFaceUpAttack(session, gatling, 0, 0);
    moveFaceUpAttack(session, ally, 0, 1);
    moveFaceUpAttack(session, opponent, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gatlingCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === gatling.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", range: ["monsterZone"] },
      { category: categoryCoin | categoryDestroy, code: undefined, event: "ignition", range: ["monsterZone"] },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === gatling.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);

    expect(restoredOpen.session.state.lastCoinResults).toEqual([1, 1, 1]);
    for (const destroyed of [gatling, ally, opponent]) {
      expect(restoredOpen.session.state.cards.find((card) => card.uid === destroyed.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.destroy | duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: gatling.uid,
        reasonEffectId: 2,
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
        eventReasonCardUid: gatling.uid,
        eventReasonEffectId: 2,
      },
      destroyedEvent(gatling.uid, gatling.uid, 0, 0),
      destroyedEvent(ally.uid, gatling.uid, 0, 1),
      destroyedEvent(opponent.uid, gatling.uid, 1, 0),
      {
        ...destroyedEvent(gatling.uid, gatling.uid, 0, 0),
        eventUids: [gatling.uid, ally.uid, opponent.uid],
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Gatling Dragon");
  expect(script).toContain("c:EnableReviveLimit()");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,81480460,25551951)");
  expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_COIN)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("Duel.IsExistingMatchingCard(nil,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,3)");
  expect(script).toContain("local g=Duel.GetMatchingGroup(nil,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("local ct=Duel.CountHeads(Duel.TossCoin(tp,3))");
  expect(script).toContain("if ct>#g then ct=#g end");
  expect(script).toContain("local dg=g:Select(tp,ct,ct,nil)");
  expect(script).toContain("Duel.HintSelection(dg)");
  expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: gatlingCode, name: "Gatling Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, level: 8, attack: 2600, defense: 1200 },
    { code: allyCode, name: "Gatling Dragon Ally", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: opponentCode, name: "Gatling Dragon Opponent", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
  ];
}

function destroyedEvent(cardUid: string, sourceUid: string, controller: PlayerId, sequence: number) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventReason: duelReason.destroy | duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 2,
    eventPreviousState: { controller, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence },
    eventCurrentState: { controller, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence },
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
