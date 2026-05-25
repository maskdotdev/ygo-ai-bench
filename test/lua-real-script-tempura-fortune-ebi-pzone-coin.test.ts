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
const ebiCode = "86304179";
const hasEbiScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ebiCode}.lua`));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasEbiScript)("Lua real script Tempura of Fortune EBI PZone coin", () => {
  it("restores targeted PZone TossCoin into self-destruction and scale LP loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ebiCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 6, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ebiCode] }, 1: { main: [] } });
    startDuel(session);

    const ebi = requireCard(session, ebiCode);
    movePendulumZone(session, ebi, 0, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ebiCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === ebi.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);

    expect(restoredOpen.session.state.lastCoinResults).toEqual([0]);
    expect(restoredOpen.session.state.players[0].lifePoints).toBe(5600);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ebi.uid)).toMatchObject({
      location: "extraDeck",
      controller: 0,
      reason: duelReason.destroy | duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ebi.uid,
      reasonEffectId: 3,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "coinTossed", "destroyed", "lifePointsChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: ebi.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ebi.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ebi.uid,
        eventReason: duelReason.destroy | duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ebi.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Tempura of Fortune - EBI");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN+CATEGORY_SPECIAL_SUMMON+CATEGORY_DESTROY)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
  expect(script).toContain("Duel.SelectTarget(tp,nil,tp,LOCATION_PZONE,0,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,tp,0)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,g,1,tp,0)");
  expect(script).toContain("local res=Duel.TossCoin(tp,1)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
  expect(script).toContain("Duel.SetLP(tp,Duel.GetLP(tp)-tc:GetScale()*300)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const ebi = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === ebiCode);
  expect(ebi).toBeDefined();
  return [ebi!];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function movePendulumZone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
