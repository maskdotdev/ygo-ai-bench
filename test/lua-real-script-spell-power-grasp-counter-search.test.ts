import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const spellPowerCode = "75014062";
const targetCode = "750140620";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSpellPowerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${spellPowerCode}.lua`));
const counterSpell = 0x1;
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSpellPowerScript)("Lua real script Spell Power Grasp counter search", () => {
  it("restores targeted Spell Counter placement into optional same-name Deck search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${spellPowerCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards(workspace));
    const session = createOpenSession(reader, workspace, source);
    const spell = requireCard(session, spellPowerCode);
    const searchCopy = session.state.cards.find((card) => card.code === spellPowerCode && card.uid !== spell.uid)!;
    const target = requireCard(session, targetCode);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, {
      promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }],
    });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === spell.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);

    expect(getDuelCardCounter(findCard(restored.session, target.uid), counterSpell)).toBe(1);
    expect(findCard(restored.session, searchCopy.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonCardUid: spell.uid,
      reasonEffectId: 1,
      reasonPlayer: 0,
    });
    expect(restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 1200224992, returned: true },
    ]);
    expect(restored.host.messages).toContain(`confirmed 1: ${spellPowerCode}`);
    expect(restored.session.state.eventHistory.filter((event) =>
      ["becameTarget", "counterAdded", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: target.uid, eventCode: 0x10000, eventName: "counterAdded", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: spell.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: searchCopy.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: spell.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: searchCopy.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: spell.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: searchCopy.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: spell.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER+CATEGORY_SEARCH+CATEGORY_TOHAND)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,COUNTER_SPELL)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("tc:AddCounter(COUNTER_SPELL,1)");
  expect(script).toContain("Duel.GetFirstMatchingCard(s.tfilter,tp,LOCATION_DECK,0,nil)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,0))");
  expect(script).toContain("Duel.SendtoHand(th,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,th)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === spellPowerCode),
    { code: targetCode, name: "Spell Counter Permit Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1200 },
  ];
}

function createOpenSession(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, source: ScriptSource): DuelSession {
  const session = createDuel({ seed: 75014062, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [spellPowerCode, spellPowerCode, targetCode] }, 1: { main: [] } });
  startDuel(session);
  const spell = requireCard(session, spellPowerCode);
  const target = requireCard(session, targetCode);
  moveDuelCard(session.state, spell.uid, "hand", 0);
  const movedTarget = moveDuelCard(session.state, target.uid, "monsterZone", 0);
  movedTarget.faceUp = true;
  movedTarget.position = "faceUpAttack";
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(spellPowerCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(targetCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(3);
  return session;
}

type ScriptSource = { readScript(name: string): string | undefined };

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ScriptSource {
  return {
    readScript(name: string) {
      if (name === `c${targetCode}.lua`) return counterPermitTargetScript();
      return workspace.readScript(name);
    },
  };
}

function counterPermitTargetScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      c:EnableCounterPermit(COUNTER_SPELL)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
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
  expect(response.legalActions).toEqual(getLegalActions(restored.session, response.state.waitingFor!));
}
