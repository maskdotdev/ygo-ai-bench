import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const crossoutCode = "65681983";
const declaredCode = "656819830";
const otherDeckCode = "656819831";
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Crossout Designator announce Deck banish", () => {
  it("restores Deck-code announce, selected banish, and same-original-code disable effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${crossoutCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_REMOVE)");
    expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsAbleToRemove,tp,LOCATION_DECK,0,nil)");
    expect(script).toContain("Duel.AnnounceCard(tp,table.unpack(s.announce_filter))");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.rmfilter,tp,LOCATION_DECK,0,1,1,nil,ac)");
    expect(script).toContain("Duel.Remove(tc,POS_FACEUP,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVING)");
    expect(script).toContain("e3:SetCode(EFFECT_DISABLE_TRAPMONSTER)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === crossoutCode),
      { code: declaredCode, name: "Crossout Declared Deck Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: otherDeckCode, name: "Crossout Other Deck Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 65681983, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [crossoutCode, declaredCode, otherDeckCode] }, 1: { main: [] } });
    startDuel(session);

    const crossout = requireCard(session, crossoutCode);
    const declared = requireCard(session, declaredCode);
    const otherDeck = requireCard(session, otherDeckCode);
    moveDuelCard(session.state, crossout.uid, "hand", 0);
    setDeckSequence(declared, 0);
    setDeckSequence(otherDeck, 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(crossoutCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === crossout.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, activation!);

    expect(restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "AnnounceCard", player: 0, options: [Number(declaredCode), Number(otherDeckCode)], descriptions: [Number(declaredCode), Number(otherDeckCode)], returned: Number(declaredCode) },
    ]);
    expect(restored.session.state.chain).toEqual([]);
    expect(restored.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === declared.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: crossout.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === otherDeck.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "banished")).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: declared.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: crossout.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === crossout.uid && [2, 10, 1020].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      label: effect.label,
      targetRange: effect.targetRange,
      luaConditionDescriptor: effect.luaConditionDescriptor,
    }))).toEqual([
      { code: 2, label: Number(declaredCode), targetRange: [12, 12], luaConditionDescriptor: undefined },
      {
        code: 1020,
        label: Number(declaredCode),
        targetRange: undefined,
        luaConditionDescriptor: "condition:chain-solving-effect-handler-original-code-label",
      },
      { code: 10, label: Number(declaredCode), targetRange: [4, 4], luaConditionDescriptor: undefined },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === crossout.uid && [2, 10, 1020].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      label: effect.label,
      targetRange: effect.targetRange,
      luaConditionDescriptor: effect.luaConditionDescriptor,
    }))).toEqual([
      { code: 2, label: Number(declaredCode), targetRange: [12, 12], luaConditionDescriptor: undefined },
      {
        code: 1020,
        label: Number(declaredCode),
        targetRange: undefined,
        luaConditionDescriptor: "condition:chain-solving-effect-handler-original-code-label",
      },
      { code: 10, label: Number(declaredCode), targetRange: [4, 4], luaConditionDescriptor: undefined },
    ]);
    expect(restoredResolved.host.messages).not.toContain("unsupported callback");
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function setDeckSequence(card: DuelCardInstance, sequence: number): void {
  card.location = "deck";
  card.controller = 0;
  card.sequence = sequence;
  card.faceUp = false;
  card.position = "faceDown";
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
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
