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
const acidRainCode = "21323861";
const hasAcidRainScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${acidRainCode}.lua`));
const ownMachineCode = "213238610";
const opponentMachineCode = "213238611";
const facedownMachineCode = "213238612";
const warriorDecoyCode = "213238613";
const responderCode = "213238614";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceMachine = 0x20;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasAcidRainScript)("Lua real script Acid Rain Machine group destroy", () => {
  it("restores prompt-free face-up Machine group destruction across both monster zones", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${acidRainCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsRace(RACE_MACHINE) and c:IsFaceup()");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,sg,#sg,0,0)");
    expect(script).toContain("Duel.Destroy(sg,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === acidRainCode),
      { code: ownMachineCode, name: "Acid Rain Own Machine", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 4, attack: 1600, defense: 1200 },
      { code: opponentMachineCode, name: "Acid Rain Opponent Machine", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 4, attack: 1800, defense: 1000 },
      { code: facedownMachineCode, name: "Acid Rain Face-down Machine", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 4, attack: 1500, defense: 1500 },
      { code: warriorDecoyCode, name: "Acid Rain Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1700, defense: 1000 },
      { code: responderCode, name: "Acid Rain Chain Responder", kind: "spell", typeFlags: typeSpell | 0x10000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 21323861, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [acidRainCode, ownMachineCode, facedownMachineCode] }, 1: { main: [opponentMachineCode, warriorDecoyCode, responderCode] } });
    startDuel(session);

    const acidRain = requireCard(session, acidRainCode);
    const ownMachine = requireCard(session, ownMachineCode);
    const opponentMachine = requireCard(session, opponentMachineCode);
    const facedownMachine = requireCard(session, facedownMachineCode);
    const warriorDecoy = requireCard(session, warriorDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, acidRain.uid, "hand", 0);
    moveFaceUpAttack(session, ownMachine, 0);
    moveFaceUpAttack(session, opponentMachine, 1);
    const movedFacedown = moveDuelCard(session.state, facedownMachine.uid, "monsterZone", 0);
    movedFacedown.sequence = 1;
    movedFacedown.faceUp = false;
    movedFacedown.position = "faceDownDefense";
    moveFaceUpAttack(session, warriorDecoy, 1).sequence = 1;
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
    expect(host.loadCardScript(Number(acidRainCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === acidRain.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    const destroyedUids = [ownMachine.uid, opponentMachine.uid];
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        player: 0,
        sourceUid: acidRain.uid,
        effectId: "lua-1-1002",
        activationLocation: "hand",
        activationSequence: 0,
        operationInfos: [{ category: 0x1, targetUids: destroyedUids, count: 2, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyLuaRestoreAndAssert(restoredChain, pass!);

    expect(restoredChain.session.state.chain).toEqual([]);
    expect(restoredChain.session.state.cards.find((card) => card.uid === acidRain.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === ownMachine.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.destroy });
    expect(restoredChain.session.state.cards.find((card) => card.uid === opponentMachine.uid)).toMatchObject({ location: "graveyard", controller: 1, reason: duelReason.effect | duelReason.destroy });
    expect(restoredChain.session.state.cards.find((card) => card.uid === facedownMachine.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: false });
    expect(restoredChain.session.state.cards.find((card) => card.uid === warriorDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 1, faceUp: true });
    expect(restoredChain.host.messages).not.toContain("acid rain responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      destroyedEvent(ownMachine.uid, acidRain.uid, 0, 0),
      destroyedEvent(opponentMachine.uid, acidRain.uid, 1, 0),
      { ...destroyedEvent(ownMachine.uid, acidRain.uid, 0, 0), eventUids: destroyedUids },
    ]);
  });
});

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function destroyedEvent(uid: string, sourceUid: string, controller: PlayerId, sequence: number) {
  return {
    eventName: "destroyed",
    eventCode: 1029,
    eventCardUid: uid,
    eventPreviousState: { location: "monsterZone", controller, sequence, position: "faceUpAttack", faceUp: true },
    eventCurrentState: { location: "graveyard", controller, sequence, position: "faceUpAttack", faceUp: true },
    eventReason: duelReason.effect | duelReason.destroy,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
  };
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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
      e:SetOperation(function(e,tp) Debug.Message("acid rain responder resolved") end)
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
}
