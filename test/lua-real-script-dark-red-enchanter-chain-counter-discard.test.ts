import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
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
const enchanterCode = "45462639";
const chainSpellCode = "454626390";
const discardCode = "454626391";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasEnchanterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${enchanterCode}.lua`));
const typeSpell = 0x2;
const typeMonster = 0x1;
const typeEffect = 0x20;
const counterSpell = 0x1;
const categoryCounter = 0x800000;
const categoryHandes = 0x80;
const eventChainSolved = 1022;
const eventChaining = 1027;
const effectUpdateAttack = 100;
const effectFlagCannotDisable = 0x400;
const effectFlagSingleRange = 0x20000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasEnchanterScript)("Lua real script Dark Red Enchanter chain counter discard", () => {
  it("restores summon counters, chain-solved Spell counter gain, ATK scaling, and counter-cost discard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${enchanterCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const source = {
      readScript(name: string) {
        if (name === `c${chainSpellCode}.lua`) return chainSpellScript();
        return workspace.readScript(name);
      },
    };

    const restoredSummon = createRestoredSummonState(reader, workspace, source);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const enchanter = requireCard(restoredSummon.session, enchanterCode);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === enchanter.uid && effect.code !== 0x10000 + counterSpell).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: categoryCounter, code: 1100, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "normalSummoned", value: undefined },
      { category: undefined, code: eventChaining, event: "continuous", property: effectFlagCannotDisable, range: ["monsterZone"], triggerEvent: undefined, value: undefined },
      { category: undefined, code: eventChainSolved, event: "continuous", property: undefined, range: ["monsterZone"], triggerEvent: undefined, value: undefined },
      { category: undefined, code: effectUpdateAttack, event: "continuous", property: effectFlagSingleRange, range: ["monsterZone"], triggerEvent: undefined, value: undefined },
      { category: categoryHandes, code: undefined, event: "ignition", property: undefined, range: ["monsterZone"], triggerEvent: undefined, value: undefined },
    ]);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === enchanter.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);

    const restoredCounter = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), source, reader);
    expectCleanRestore(restoredCounter);
    expectRestoredLegalActions(restoredCounter, 0);
    const counterTrigger = getLuaRestoreLegalActions(restoredCounter, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === enchanter.uid && action.effectId === "lua-2-1100"
    );
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredCounter, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounter, counterTrigger!);
    resolveRestoredChain(restoredCounter);
    expect(getDuelCardCounter(findCard(restoredCounter.session, enchanter.uid), counterSpell)).toBe(2);
    expect(currentAttack(findCard(restoredCounter.session, enchanter.uid), restoredCounter.session.state)).toBe(2300);

    const chainSpell = requireCard(restoredCounter.session, chainSpellCode);
    const spellActivation = getLuaRestoreLegalActions(restoredCounter, 0).find((action) => action.type === "activateEffect" && action.uid === chainSpell.uid);
    expect(spellActivation, JSON.stringify(getLuaRestoreLegalActions(restoredCounter, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounter, spellActivation!);
    resolveRestoredChain(restoredCounter);
    expect(getDuelCardCounter(findCard(restoredCounter.session, enchanter.uid), counterSpell)).toBe(3);
    expect(currentAttack(findCard(restoredCounter.session, enchanter.uid), restoredCounter.session.state)).toBe(2600);
    expect(restoredCounter.host.messages).toContain("dark red chain spell resolved");
    expect(restoredCounter.session.state.eventHistory.filter((event) => ["normalSummoned", "counterAdded", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventChainDepth: event.eventChainDepth,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: enchanter.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventChainDepth: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: enchanter.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: enchanter.uid, eventReasonEffectId: 2, eventChainDepth: undefined },
      { eventName: "chainSolved", eventCode: eventChainSolved, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventChainDepth: 1 },
      { eventName: "chainSolved", eventCode: eventChainSolved, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventChainDepth: 1 },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: enchanter.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: enchanter.uid, eventReasonEffectId: 7, eventChainDepth: undefined },
    ]);

    const restoredDiscard = createRestoredDiscardState(reader, workspace);
    expectCleanRestore(restoredDiscard);
    expectRestoredLegalActions(restoredDiscard, 0);
    const discardEnchanter = requireCard(restoredDiscard.session, enchanterCode);
    const discardTarget = requireCard(restoredDiscard.session, discardCode);
    const discard = getLuaRestoreLegalActions(restoredDiscard, 0).find((action) =>
      action.type === "activateEffect" && action.uid === discardEnchanter.uid && action.effectId === "lua-6"
    );
    expect(discard, JSON.stringify(getLuaRestoreLegalActions(restoredDiscard, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDiscard, discard!);
    expect(getDuelCardCounter(findCard(restoredDiscard.session, discardEnchanter.uid), counterSpell)).toBe(0);
    resolveRestoredChain(restoredDiscard);
    expect(findCard(restoredDiscard.session, discardTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: discardEnchanter.uid,
      reasonEffectId: 6,
    });
    expect(restoredDiscard.session.state.eventHistory.filter((event) => ["counterRemoved", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: discardEnchanter.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: discardEnchanter.uid, eventReasonEffectId: 6 },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: discardTarget.uid, eventReason: duelReason.effect | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: discardEnchanter.uid, eventReasonEffectId: 6 },
    ]);
  });
});

function createRestoredSummonState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  source: { readScript(name: string): string | undefined },
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 45462639, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [enchanterCode, chainSpellCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, enchanterCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, chainSpellCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerScripts(session, workspace, source, [enchanterCode, chainSpellCode]);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function createRestoredDiscardState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 45462640, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [enchanterCode] }, 1: { main: [discardCode] } });
  startDuel(session);
  const enchanter = moveFaceUpAttack(session, requireCard(session, enchanterCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, discardCode).uid, "hand", 1);
  expect(addDuelCardCounter(enchanter, counterSpell, 2)).toBe(true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerScripts(session, workspace, workspace, [enchanterCode]);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const enchanter = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === enchanterCode);
  expect(enchanter).toBeDefined();
  return [
    { ...enchanter!, level: 4 },
    { code: chainSpellCode, name: "Dark Red Chain Spell", kind: "spell", typeFlags: typeSpell },
    { code: discardCode, name: "Dark Red Discard", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function chainSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("dark red chain spell resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function registerScripts(
  session: DuelSession,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  source: { readScript(name: string): string | undefined },
  codes: string[],
): void {
  const host = createLuaScriptHost(session, workspace);
  for (const code of codes) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(codes.length);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Dark Red Enchanter");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,2,0,COUNTER_SPELL)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_SPELL,2)");
  expect(script).toContain("e0:SetCode(EVENT_CHAINING)");
  expect(script).toContain("e0:SetOperation(aux.chainreg)");
  expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVED)");
  expect(script).toContain("re:IsHasType(EFFECT_TYPE_ACTIVATE) and re:IsSpellEffect() and e:GetHandler():GetFlagEffect(1)>0");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_SPELL,1)");
  expect(script).toContain("return c:GetCounter(COUNTER_SPELL)*300");
  expect(script).toContain("e4:SetCategory(CATEGORY_HANDES)");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,COUNTER_SPELL,2,REASON_COST)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,0,LOCATION_HAND)>0");
  expect(script).toContain("Duel.SendtoGrave(sg,REASON_DISCARD|REASON_EFFECT)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
