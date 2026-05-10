import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Spirit's Invitation return bounce", () => {
  it("restores its sent-to-hand Spirit trigger and opponent-selected monster return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const invitationCode = "92394653";
    const susaCode = "40473581";
    const opponentMonsterCode = "92394654";
    const responderCode = "92394655";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === invitationCode || card.code === susaCode),
      { code: opponentMonsterCode, name: "Spirit's Invitation Opponent Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200 },
      { code: responderCode, name: "Spirit's Invitation Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 923, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [invitationCode, susaCode] }, 1: { main: [opponentMonsterCode, responderCode] } });
    startDuel(session);

    const invitation = session.state.cards.find((card) => card.code === invitationCode);
    const susa = session.state.cards.find((card) => card.code === susaCode);
    const opponentMonster = session.state.cards.find((card) => card.code === opponentMonsterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(invitation).toBeDefined();
    expect(susa).toBeDefined();
    expect(opponentMonster).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, invitation!.uid, "spellTrapZone", 0);
    invitation!.faceUp = false;
    invitation!.position = "faceDown";
    moveDuelCard(session.state, susa!.uid, "hand", 0);
    moveDuelCard(session.state, opponentMonster!.uid, "monsterZone", 1);
    opponentMonster!.faceUp = true;
    opponentMonster!.position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(invitationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(susaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(1);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
    const activateTrap = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === invitation!.uid);
    expect(activateTrap, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivation, activateTrap!);
    expect(restoredActivation.session.state.chain[0]).toMatchObject({ sourceUid: invitation!.uid });

    const restoredActivationChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredActivationChain.restoreComplete, restoredActivationChain.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restoredActivationChain, 1)).toEqual(getGroupedDuelLegalActions(restoredActivationChain.session, 1));
    expect(getLuaRestoreLegalActions(restoredActivationChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredActivationChain);
    expect(restoredActivationChain.host.messages).not.toContain("invitation responder resolved");
    expect(restoredActivationChain.session.state.cards.find((card) => card.uid === invitation!.uid)).toMatchObject({
      location: "spellTrapZone",
      faceUp: true,
    });

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(restoredActivationChain.session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === susa!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);
    expect(restoredSummonWindow.session.state.cards.find((card) => card.uid === susa!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "normal",
      faceUp: true,
    });

    const restoredEndPhasePath = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredEndPhasePath.restoreComplete, restoredEndPhasePath.incompleteReasons.join("; ")).toBe(true);
    changeRestoredPhase(restoredEndPhasePath, 0, "battle");
    changeRestoredPhase(restoredEndPhasePath, 0, "main2");
    changeRestoredPhase(restoredEndPhasePath, 0, "end");
    expect(restoredEndPhasePath.session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: susa!.uid, eventName: "phaseEnd", eventCode: 0x1200, player: 0 }),
      ]),
    );

    const restoredSpiritReturn = restoreDuelWithLuaScripts(serializeDuel(restoredEndPhasePath.session), source, reader);
    expect(restoredSpiritReturn.restoreComplete, restoredSpiritReturn.incompleteReasons.join("; ")).toBe(true);
    const spiritReturn = getLuaRestoreLegalActions(restoredSpiritReturn, 0).find((action) => action.type === "activateTrigger" && action.uid === susa!.uid);
    expect(spiritReturn, JSON.stringify(getLuaRestoreLegalActions(restoredSpiritReturn, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSpiritReturn, spiritReturn!);
    expect(restoredSpiritReturn.session.state.chain[0]).toMatchObject({
      sourceUid: susa!.uid,
      operationInfos: [{ category: 0x8, targetUids: [susa!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restoredSpiritReturnChain = restoreDuelWithLuaScripts(serializeDuel(restoredSpiritReturn.session), source, reader);
    expect(restoredSpiritReturnChain.restoreComplete, restoredSpiritReturnChain.incompleteReasons.join("; ")).toBe(true);
    resolveRestoredChain(restoredSpiritReturnChain);
    expect(restoredSpiritReturnChain.session.state.cards.find((card) => card.uid === susa!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredSpiritReturnChain.session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUid: invitation!.uid,
          eventName: "sentToHand",
          eventCode: 1012,
          eventCardUid: susa!.uid,
          player: 0,
        }),
      ]),
    );

    const restoredInvitationTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSpiritReturnChain.session), source, reader);
    expect(restoredInvitationTrigger.restoreComplete, restoredInvitationTrigger.incompleteReasons.join("; ")).toBe(true);
    const invitationTrigger = getLuaRestoreLegalActions(restoredInvitationTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === invitation!.uid);
    expect(invitationTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredInvitationTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredInvitationTrigger, invitationTrigger!);
    expect(restoredInvitationTrigger.session.state.chain[0]).toMatchObject({
      sourceUid: invitation!.uid,
      eventName: "sentToHand",
      eventCode: 1012,
      eventCardUid: susa!.uid,
      operationInfos: [{ category: 0x8, targetUids: [opponentMonster!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restoredInvitationChain = restoreDuelWithLuaScripts(serializeDuel(restoredInvitationTrigger.session), source, reader);
    expect(restoredInvitationChain.restoreComplete, restoredInvitationChain.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restoredInvitationChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredInvitationChain);
    expect(restoredInvitationChain.session.state.cards.find((card) => card.uid === opponentMonster!.uid)).toMatchObject({
      location: "hand",
      controller: 1,
    });
    expect(restoredInvitationChain.session.state.cards.find((card) => card.uid === invitation!.uid)).toMatchObject({
      location: "spellTrapZone",
      faceUp: true,
    });
    expect(restoredInvitationChain.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "sentToHand", eventCode: 1012, eventCardUid: susa!.uid }),
        expect.objectContaining({ eventName: "sentToHand", eventCode: 1012, eventCardUid: opponentMonster!.uid }),
      ]),
    );
    expect(restoredInvitationChain.host.messages).not.toContain("invitation responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetHintTiming(TIMING_END_PHASE)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("invitation responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function changeRestoredPhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, phase: "battle" | "main2" | "end"): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
