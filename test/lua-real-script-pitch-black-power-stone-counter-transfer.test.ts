import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const powerStoneCode = "34029630";
const targetCode = "340296300";
const decoyCode = "340296301";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPowerStoneScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${powerStoneCode}.lua`));
const counterSpell = 0x1;
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const typeEffect = 0x20;
const raceSpellcaster = 0x2;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasPowerStoneScript)("Lua real script Pitch-Black Power Stone counter transfer", () => {
  it("restores face-up Spell Counter quick transfer into zero-counter self-destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${powerStoneCode}.lua`));
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredOpen({ reader, source, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const powerStone = requireCard(restoredOpen.session, powerStoneCode);
    const target = requireCard(restoredOpen.session, targetCode);
    const decoy = requireCard(restoredOpen.session, decoyCode);
    expect(getDuelCardCounter(findCard(restoredOpen.session, powerStone.uid), counterSpell)).toBe(1);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === powerStone.uid && action.effectId === "lua-3-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);

    expect(restoredOpen.host.promptDecisions).toEqual([]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "counterAdded", "counterRemoved"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: powerStone.uid, eventCode: 0x20000, eventName: "counterRemoved", eventReason: duelReason.effect, eventReasonCardUid: powerStone.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventCardUid: target.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: powerStone.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(findCard(restoredOpen.session, powerStone.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: powerStone.uid,
      reasonEffectId: 4,
      reasonPlayer: 0,
    });
    expect(getDuelCardCounter(findCard(restoredOpen.session, powerStone.uid), counterSpell)).toBe(0);
    expect(getDuelCardCounter(findCard(restoredOpen.session, target.uid), counterSpell)).toBe(1);
    expect(getDuelCardCounter(findCard(restoredOpen.session, decoy.uid), counterSpell)).toBe(0);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "counterAdded", "counterRemoved", "destroyed"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: powerStone.uid, eventCode: 0x20000, eventName: "counterRemoved", eventReason: duelReason.effect, eventReasonCardUid: powerStone.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventCardUid: target.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: powerStone.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventCardUid: powerStone.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: powerStone.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
    ]);
    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: powerStoneCode, name: "Pitch-Black Power Stone", kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: targetCode, name: "Power Stone Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1600, defense: 1200 },
    { code: decoyCode, name: "Power Stone Counter Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1400, defense: 1000 },
  ];
}

function createRestoredOpen({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ScriptSource;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 34029630, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [powerStoneCode, targetCode, decoyCode] }, 1: { main: [] } });
  startDuel(session);
  const powerStone = moveFaceUpTrap(session, requireCard(session, powerStoneCode), 0, 0);
  expect(addDuelCardCounter(powerStone, counterSpell, 1)).toBe(true);
  moveFaceUpAttack(session, requireCard(session, targetCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, decoyCode), 0, 1);
  session.state.turn = 2;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  for (const code of [powerStoneCode, targetCode, decoyCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(3);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

type ScriptSource = { readScript(name: string): string | undefined };

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ScriptSource {
  return {
    readScript(name: string) {
      if ([`c${targetCode}.lua`, `c${decoyCode}.lua`].includes(name)) return counterPermitTargetScript();
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

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Pitch-Black Power Stone");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
  expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("Duel.IsCanAddCounter(tp,COUNTER_SPELL,3,c)");
  expect(script).toContain("c:AddCounter(COUNTER_SPELL,3)");
  expect(script).toContain("Duel.SelectEffectYesNo(tp,c,94)");
  expect(script).toContain("e:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,c)");
  expect(script).toContain("c:RegisterFlagEffect(0,RESET_CHAIN,EFFECT_FLAG_CLIENT_HINT,1,0,65)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e4:SetCode(EFFECT_SELF_DESTROY)");
  expect(script).toContain("tc:AddCounter(COUNTER_SPELL,1)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function slimEvent(event: { eventName: string; eventCode?: number; eventCardUid?: string; eventReason?: number; eventReasonCardUid?: string; eventReasonEffectId?: number; eventReasonPlayer?: PlayerId }) {
  return {
    eventCardUid: event.eventCardUid,
    eventCode: event.eventCode,
    eventName: event.eventName,
    eventReason: event.eventReason,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    eventReasonPlayer: event.eventReasonPlayer,
  };
}
