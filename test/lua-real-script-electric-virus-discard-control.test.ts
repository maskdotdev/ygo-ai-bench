import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
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
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceDragon = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Electric Virus discard control", () => {
  it("restores Electric Virus's discard cost, race-gated target, temporary GetControl, and End Phase return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const electricVirusCode = "24725825";
    const dragonTargetCode = "24725826";
    const warriorDecoyCode = "24725827";
    const responderCode = "24725828";
    const script = workspace.readScript(`c${electricVirusCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_HAND)");
    expect(script).toContain("e:GetHandler():IsAbleToGraveAsCost()");
    expect(script).toContain("Duel.SendtoGrave(e:GetHandler(),REASON_COST|REASON_DISCARD)");
    expect(script).toContain("c:IsRace(RACE_MACHINE|RACE_DRAGON)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,g,1,0,0)");
    expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === electricVirusCode),
      { code: dragonTargetCode, name: "Electric Virus Dragon Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, level: 4, attack: 1800, defense: 1200 },
      { code: warriorDecoyCode, name: "Electric Virus Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1700, defense: 1100 },
      { code: responderCode, name: "Electric Virus Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 24725825, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [electricVirusCode] }, 1: { main: [dragonTargetCode, warriorDecoyCode, responderCode] } });
    startDuel(session);

    const electricVirus = requireCard(session, electricVirusCode);
    const dragonTarget = requireCard(session, dragonTargetCode);
    const warriorDecoy = requireCard(session, warriorDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, electricVirus.uid, "hand", 0);
    moveDuelCard(session.state, dragonTarget.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, warriorDecoy.uid, "monsterZone", 1).position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(electricVirusCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenWindow);
    expectRestoredLegalActions(restoredOpenWindow, 0);
    const activation = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((action) => action.type === "activateEffect" && action.uid === electricVirus.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenWindow, activation!);

    expect(restoredOpenWindow.session.state.cards.find((card) => card.uid === electricVirus.uid)).toMatchObject({
      location: "graveyard",
      reasonPlayer: 0,
      reasonCardUid: electricVirus.uid,
    });
    expect((restoredOpenWindow.session.state.cards.find((card) => card.uid === electricVirus.uid)!.reason! & duelReason.cost) !== 0).toBe(true);
    expect((restoredOpenWindow.session.state.cards.find((card) => card.uid === electricVirus.uid)!.reason! & duelReason.discard) !== 0).toBe(true);
    expect(restoredOpenWindow.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === electricVirus.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: electricVirus.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: electricVirus.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restoredOpenWindow.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: electricVirus.uid,
        player: 0,
        activationLocation: "graveyard",
        activationSequence: 0,
        operationInfos: [{ category: 0x2000, targetUids: [dragonTarget.uid], count: 1, player: 0, parameter: 0 }],
        targetUids: [dragonTarget.uid],
      },
    ]);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expectCleanRestore(restoredChainWindow);
    expectRestoredLegalActions(restoredChainWindow, 1);
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === electricVirus.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === warriorDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(getLuaRestoreLegalActions(restoredChainWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChainWindow);

    expect(restoredChainWindow.session.state.chain).toHaveLength(0);
    expect(restoredChainWindow.host.messages).not.toContain("electric virus responder resolved");
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === dragonTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
    });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === warriorDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === dragonTarget.uid)).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: dragonTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: electricVirus.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredChainWindow.session.state.effects.find((effect) => effect.registryKey === `lua:${dragonTargetCode}:temporary-control-return:${dragonTarget.uid}`)).toMatchObject({
      code: 0x1200,
      controller: 1,
      event: "continuous",
      luaValueDescriptor: "temporary-control-return",
      ownerPlayer: 1,
      registryKey: `lua:${dragonTargetCode}:temporary-control-return:${dragonTarget.uid}`,
      sourceUid: dragonTarget.uid,
      value: 1,
    });

    const restoredReturnWindow = restoreDuelWithLuaScripts(serializeDuel(restoredChainWindow.session), source, reader);
    expectCleanRestore(restoredReturnWindow);
    expectRestoredLegalActions(restoredReturnWindow, 0);
    expect(restoredReturnWindow.session.state.cards.find((card) => card.uid === dragonTarget.uid)).toMatchObject({ controller: 0, previousController: 1 });
    expect(restoredReturnWindow.session.state.effects.map((effect) => effect.registryKey)).toContain(`lua:${dragonTargetCode}:temporary-control-return:${dragonTarget.uid}`);
    const endTurn = getLuaRestoreLegalActions(restoredReturnWindow, 0).find((action) => action.type === "endTurn");
    expect(endTurn, JSON.stringify(getLuaRestoreLegalActions(restoredReturnWindow, 0), null, 2)).toBeDefined();
    const nextTurn = applyLuaRestoreResponse(restoredReturnWindow, endTurn!);
    expect(nextTurn.ok, nextTurn.error).toBe(true);
    expect(restoredReturnWindow.session.state.cards.find((card) => card.uid === dragonTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
    });
    expect(restoredReturnWindow.session.state.effects.map((effect) => effect.registryKey)).not.toContain(`lua:${dragonTargetCode}:temporary-control-return:${dragonTarget.uid}`);
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("electric virus responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(restored.session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
