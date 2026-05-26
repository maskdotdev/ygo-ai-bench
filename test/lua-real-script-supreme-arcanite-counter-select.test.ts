import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
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
const supremeCode = "21113684";
const drawCode = "211136840";
const destroyTargetCode = "211136841";
const counterSpell = 0x1;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Supreme Arcanite counter SelectEffect", () => {
  it("restores Spell Counter ATK scaling and RemoveCounterFromField cost into draw and destroy branches", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${supremeCode}.lua`);
    expectScriptShape(script);

    const draw = createOpenState(workspace, 2);
    expect(currentAttack(findCard(draw.restored.session, draw.supreme.uid), draw.restored.session.state)).toBe(3400);
    applyRestored(draw.restored, findIgnition(draw.restored, draw.supreme.uid));
    expect(draw.restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1, 2], descriptions: [337818946, 337818947], returned: 2 },
    ]);
    expect(draw.restored.session.state.chain).toEqual([]);
    expect(getDuelCardCounter(findCard(draw.restored.session, draw.supreme.uid), counterSpell)).toBe(1);
    expect(currentAttack(findCard(draw.restored.session, draw.supreme.uid), draw.restored.session.state)).toBe(2400);
    expect(draw.restored.session.state.cards.find((card) => card.uid === draw.drawCard.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });

    const destroy = createOpenState(workspace, 2, 1);
    applyRestored(destroy.restored, findIgnition(destroy.restored, destroy.supreme.uid));
    expect(destroy.restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1, 2], descriptions: [337818946, 337818947], returned: 1 },
    ]);
    expect(getDuelCardCounter(findCard(destroy.restored.session, destroy.supreme.uid), counterSpell)).toBe(0);
    expect(destroy.restored.session.state.cards.find((card) => card.uid === destroy.supreme.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: destroy.supreme.uid,
      reasonEffectId: 6,
    });
    expect(destroy.restored.session.state.eventHistory.filter((event) => ["counterRemoved", "becameTarget", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "counterRemoved",
        eventCode: 0x20000,
        eventCardUid: destroy.supreme.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroy.supreme.uid,
        eventReasonEffectId: 6,
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: destroy.supreme.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 6,
        eventChainLinkId: "chain-2",
        eventChainDepth: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroy.supreme.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroy.supreme.uid,
        eventReasonEffectId: 6,
      },
    ]);
  });
});

function createOpenState(workspace: ReturnType<typeof createUpstreamNodeWorkspace>, counterCount: number, branch = 2) {
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === supremeCode),
    { code: drawCode, name: "Supreme Arcanite Draw Card", kind: "spell", typeFlags: typeSpell },
    { code: destroyTargetCode, name: "Supreme Arcanite Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 21113684 + branch, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [drawCode], extra: [supremeCode] }, 1: { main: [destroyTargetCode] } });
  startDuel(session);
  const supreme = requireCard(session, supremeCode);
  const drawCard = requireCard(session, drawCode);
  const target = requireCard(session, destroyTargetCode);
  moveFaceUpAttack(session, supreme, 0);
  supreme.summonType = "fusion";
  moveFaceUpAttack(session, target, 1);
  expect(addDuelCardCounter(supreme, counterSpell, counterCount)).toBe(true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(supremeCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, {
    promptOverrides: [{ api: "SelectEffect", player: 0, returned: branch }],
  });
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return { restored, supreme, drawCard, target };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("Supreme Arcanite Magician");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,s.matfilter,aux.FilterBoolFunctionEx(Card.IsRace,RACE_SPELLCASTER))");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsFusionSummoned()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,e:GetHandler(),2,tp,COUNTER_SPELL)");
  expect(script).toContain("c:AddCounter(COUNTER_SPELL,2)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("return c:GetCounter(COUNTER_SPELL)*1000");
  expect(script).toContain("e3:SetCost(Cost.RemoveCounterFromField(COUNTER_SPELL,1))");
  expect(script).toContain("local op=Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.SelectTarget(tp,nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,tp,0)");
  expect(script).toContain("Duel.SetTargetPlayer(tp)");
  expect(script).toContain("Duel.SetTargetParam(1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
  expect(script).toContain("Duel.Draw(p,d,REASON_EFFECT)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function findIgnition(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string): Extract<DuelAction, { type: "activateEffect" }> {
  const action = getLuaRestoreLegalActions(restored, 0).find((candidate): candidate is Extract<DuelAction, { type: "activateEffect" }> => candidate.type === "activateEffect" && candidate.uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  return action!;
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
