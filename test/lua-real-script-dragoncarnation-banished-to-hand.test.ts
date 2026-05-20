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
const dragoncarnationCode = "5325424";
const hasDragoncarnationScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dragoncarnationCode}.lua`));
const dragonTargetCode = "5325425";
const warriorDecoyCode = "5325426";
const faceDownDragonCode = "5325427";
const responderCode = "5325428";
const typeMonster = 0x1;
const typeSpell = 0x2;
const raceDragon = 0x2000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasDragoncarnationScript)("Lua real script Dragoncarnation banished to hand", () => {
  it("restores face-up banished Dragon targeting through GetFirstTarget and confirms it to hand", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${dragoncarnationCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_DRAGON) and c:IsAbleToHand()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_REMOVED,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,g,1,0,0)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("tc:IsRelateToEffect(e)");
    expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,tc)");

    const cards: DuelCardData[] = [
      { code: dragoncarnationCode, name: "Dragoncarnation", kind: "trap", typeFlags: typeSpell },
      { code: dragonTargetCode, name: "Dragoncarnation Banished Dragon", kind: "monster", typeFlags: typeMonster, race: raceDragon, level: 4 },
      { code: warriorDecoyCode, name: "Dragoncarnation Warrior Decoy", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4 },
      { code: faceDownDragonCode, name: "Dragoncarnation Face-Down Dragon Decoy", kind: "monster", typeFlags: typeMonster, race: raceDragon, level: 4 },
      { code: responderCode, name: "Dragoncarnation Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5325424, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dragoncarnationCode, dragonTargetCode, warriorDecoyCode, faceDownDragonCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const dragoncarnation = requireCard(session, dragoncarnationCode);
    const dragonTarget = requireCard(session, dragonTargetCode);
    const warriorDecoy = requireCard(session, warriorDecoyCode);
    const faceDownDragon = requireCard(session, faceDownDragonCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, dragoncarnation.uid, "spellTrapZone", 0).faceUp = false;
    moveDuelCard(session.state, dragonTarget.uid, "banished", 0).faceUp = true;
    moveDuelCard(session.state, warriorDecoy.uid, "banished", 0).faceUp = true;
    moveDuelCard(session.state, faceDownDragon.uid, "banished", 0).faceUp = false;
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
    expect(host.loadCardScript(Number(dragoncarnationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === dragoncarnation.uid);
    expect(action, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, action!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x8, targetUids: [dragonTarget.uid], count: 1, player: 0, parameter: 0 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]?.targetUids).toEqual([dragonTarget.uid]);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x8, targetUids: [dragonTarget.uid], count: 1, player: 0, parameter: 0 },
    ]);
    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);

    expect(restored.session.state.cards.find((card) => card.uid === dragoncarnation.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === dragonTarget.uid)).toMatchObject({ location: "hand", controller: 0, reason: duelReason.effect });
    expect(restored.session.state.cards.find((card) => card.uid === warriorDecoy.uid)).toMatchObject({ location: "banished", controller: 0, faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === faceDownDragon.uid)).toMatchObject({ location: "banished", controller: 0, faceUp: false });
    expect(restored.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: dragonTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: dragoncarnation.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      confirmedEvent("confirmed", dragonTarget.uid, dragoncarnation.uid),
      confirmedEvent("sentToHandConfirmed", dragonTarget.uid, dragoncarnation.uid),
    ]);
    expect(restored.host.messages).not.toContain("dragoncarnation responder resolved");
  });
});

function confirmedEvent(eventName: "confirmed" | "sentToHandConfirmed", cardUid: string, sourceUid: string) {
  return {
    eventName,
    eventCode: eventName === "confirmed" ? 1211 : 1212,
    eventPlayer: 1,
    eventUids: [cardUid],
    eventValue: 1,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
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
      e:SetOperation(function(e,tp) Debug.Message("dragoncarnation responder resolved") end)
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
