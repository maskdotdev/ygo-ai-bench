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
const synchroControlCode = "88289295";
const opponentSynchroCode = "882892950";
const ownNonSynchroCode = "882892951";
const responderCode = "882892952";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const categoryControl = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Synchro Control opponent-turn return", () => {
  it("restores no-own-Synchro condition, LP cost, and opponent-turn two-end-phase control", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${synchroControlCode}.lua`);
    expect(script).toContain("--Synchro Control");
    expect(script).toContain("return not Duel.IsExistingMatchingCard(Card.IsType,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,nil,TYPE_SYNCHRO)");
    expect(script).toContain("e1:SetCost(Cost.PayLP(1000))");
    expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_SYNCHRO) and c:IsControlerCanBeChanged()");
    expect(script).toContain("if Duel.IsTurnPlayer(1-tp) then ct=2 end");
    expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,ct)");

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 88289295, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [synchroControlCode, ownNonSynchroCode] }, 1: { main: [responderCode], extra: [opponentSynchroCode] } });
    startDuel(session);

    const synchroControl = requireCard(session, synchroControlCode);
    const opponentSynchro = requireCard(session, opponentSynchroCode);
    const ownNonSynchro = requireCard(session, ownNonSynchroCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, synchroControl.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    moveFaceUpAttack(session, opponentSynchro, 1, 0);
    moveFaceUpAttack(session, ownNonSynchro, 0, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(synchroControlCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === synchroControl.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.players[0].lifePoints).toBe(7000);
    expect(restoredOpen.session.state.chain).toEqual([
      expect.objectContaining({
        player: 0,
        sourceUid: synchroControl.uid,
        operationInfos: [{ category: categoryControl, targetUids: [opponentSynchro.uid], count: 1, player: 0, parameter: 0 }],
        targetUids: [opponentSynchro.uid],
      }),
    ]);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === synchroControl.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentSynchro.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: synchroControl.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ownNonSynchro.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredOpen.host.messages).not.toContain("synchro control responder resolved");
    expect(restoredOpen.session.state.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 0x1200,
        event: "continuous",
        luaValueDescriptor: "temporary-control-return",
        ownerPlayer: 1,
        reset: { flags: 0x40801200, count: 2 },
        sourceUid: opponentSynchro.uid,
        value: 1,
      }),
    ]));
    expect(restoredOpen.session.state.eventHistory.some((event) => event.eventName === "lifePointCostPaid" && event.eventPlayer === 0 && event.eventValue === 1000)).toBe(true);

    const restoredControl = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredControl);
    expectRestoredLegalActions(restoredControl, 1);
    expect(restoredControl.session.state.cards.find((card) => card.uid === opponentSynchro.uid)).toMatchObject({ controller: 0, previousController: 1 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === synchroControlCode),
    { code: opponentSynchroCode, name: "Synchro Control Opponent Synchro", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWarrior, attribute: attributeEarth, level: 7, attack: 2400, defense: 1800 },
    { code: ownNonSynchroCode, name: "Synchro Control Own Non-Synchro", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1200 },
    { code: responderCode, name: "Synchro Control Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
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
      e:SetOperation(function(e,tp) Debug.Message("synchro control responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
