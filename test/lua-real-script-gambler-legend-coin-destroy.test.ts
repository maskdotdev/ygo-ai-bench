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
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const gamblerCode = "2196767";
const opponentACode = "21967670";
const opponentBCode = "21967671";
const hasGamblerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gamblerCode}.lua`));
const typeMonster = 0x1;
const categoryDestroy = 0x1;
const categoryHandes = 0x80;
const categoryCoin = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasGamblerScript)("Lua real script Gambler of Legend coin destroy", () => {
  it("restores three-head TossCoin ignition into opponent monster destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gamblerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 159, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gamblerCode] }, 1: { main: [opponentACode, opponentBCode] } });
    startDuel(session);

    const gambler = requireCard(session, gamblerCode);
    const opponentA = requireCard(session, opponentACode);
    const opponentB = requireCard(session, opponentBCode);
    moveFaceUpAttack(session, gambler, 0, 0);
    moveFaceUpAttack(session, opponentA, 1, 0);
    moveFaceUpAttack(session, opponentB, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gamblerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === gambler.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
    }))).toEqual([
      { category: categoryDestroy | categoryHandes | categoryCoin, code: undefined, countLimit: 1, event: "ignition", range: ["monsterZone"] },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === gambler.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(restoredOpen.session.state.lastCoinResults).toEqual([1, 1, 1]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === gambler.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentA.uid)).toMatchObject(destroyedCard(opponentA.uid, gambler.uid));
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentB.uid)).toMatchObject(destroyedCard(opponentB.uid, gambler.uid));
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["coinTossed", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 3,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: gambler.uid,
        eventReasonEffectId: 1,
      },
      destroyedEvent(opponentA.uid, gambler.uid, 1, 0),
      destroyedEvent(opponentB.uid, gambler.uid, 1, 1),
      {
        ...destroyedEvent(opponentA.uid, gambler.uid, 1, 0),
        eventUids: [opponentA.uid, opponentB.uid],
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Gambler of Legend");
  expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_HANDES+CATEGORY_COIN)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("e1:SetCountLimit(1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,3)");
  expect(script).toContain("local c1,c2,c3=Duel.TossCoin(tp,3)");
  expect(script).toContain("local total_heads=Duel.CountHeads(c1,c2,c3)");
  expect(script).toContain("if total_heads==3 then");
  expect(script).toContain("Duel.GetMatchingGroup(nil,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
  expect(script).toContain("elseif total_heads==2 then");
  expect(script).toContain("Duel.GetFieldGroup(tp,0,LOCATION_HAND):RandomSelect(tp,1)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT|REASON_DISCARD)");
  expect(script).toContain("elseif total_heads==1 then");
  expect(script).toContain("Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,nil,tp,LOCATION_ONFIELD,0,1,1,nil)");
  expect(script).toContain("elseif Duel.CountTails(c1,c2,c3)==3 then");
  expect(script).toContain("Duel.GetFieldGroup(tp,LOCATION_HAND,0)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const gambler = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === gamblerCode);
  expect(gambler).toBeDefined();
  return [
    gambler!,
    { code: opponentACode, name: "Gambler of Legend Opponent A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
    { code: opponentBCode, name: "Gambler of Legend Opponent B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1300, defense: 1000 },
  ];
}

function destroyedCard(cardUid: string, sourceUid: string) {
  return {
    uid: cardUid,
    location: "graveyard",
    reason: duelReason.effect | duelReason.destroy,
    reasonPlayer: 0,
    reasonCardUid: sourceUid,
    reasonEffectId: 1,
  };
}

function destroyedEvent(cardUid: string, sourceUid: string, controller: PlayerId, sequence: number) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: cardUid,
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
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
