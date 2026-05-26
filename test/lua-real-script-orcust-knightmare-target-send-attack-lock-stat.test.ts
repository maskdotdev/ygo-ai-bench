import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const knightmareCode = "4055337";
const targetCode = "40553370";
const sendCode = "40553371";
const darkProbeCode = "40553372";
const lightProbeCode = "40553373";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasKnightmareScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${knightmareCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeDark = 0x20;
const attributeLight = 0x10;
const raceMachine = 0x20;
const effectCannotSpecialSummon = 22;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasKnightmareScript)("Lua real script Orcust Knightmare target send attack lock stat", () => {
  it("restores grave SelfBanish target send into ATK gain and DARK summon oath", () => {
    const { workspace, reader, session } = createKnightmareSession();
    const knightmare = requireCard(session, knightmareCode);
    const target = requireCard(session, targetCode);
    const sent = requireCard(session, sendCode);
    const darkProbe = requireCard(session, darkProbeCode);
    const lightProbe = requireCard(session, lightProbeCode);
    moveDuelCard(session.state, knightmare.uid, "graveyard", 0).faceUp = true;
    knightmare.turnId = 1;
    moveFaceUpAttack(session, target, 0);
    moveDuelCard(session.state, darkProbe.uid, "hand", 0);
    moveDuelCard(session.state, lightProbe.uid, "hand", 0);
    session.state.turn = 3;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(knightmareCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === knightmare.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 42, event: "continuous", id: "lua-1-42", property: undefined, range: ["graveyard"] },
      { category: 0x200020, code: undefined, event: "ignition", id: "lua-2", property: 0x10, range: ["graveyard"] },
      { category: 0x200020, code: 1002, event: "quick", id: "lua-3-1002", property: 0x4010, range: ["graveyard"] },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const ignition = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === knightmare.uid && action.effectId === "lua-2");
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, ignition!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === knightmare.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: knightmare.uid,
      reasonEffectId: 2,
    });
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === sent.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: knightmare.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(2300);
    expect(restoredOpen.session.state.effects.find((effect) => effect.sourceUid === target.uid && effect.code === effectUpdateAttack)).toMatchObject({
      code: effectUpdateAttack,
      value: 500,
    });
    expect(restoredOpen.session.state.effects.find((effect) => effect.sourceUid === knightmare.uid && effect.code === effectCannotSpecialSummon)).toMatchObject({
      code: effectCannotSpecialSummon,
      property: 0x80800,
      targetRange: [1, 0],
      luaTargetDescriptor: "target:not-attribute:32",
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["banished", "becameTarget", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { current: "banished", eventCardUid: knightmare.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: knightmare.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "graveyard", relatedEffectId: undefined },
      { current: "monsterZone", eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", relatedEffectId: 2 },
      { current: "graveyard", eventCardUid: sent.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: knightmare.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "deck", relatedEffectId: undefined },
    ]);

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredLock);
    expectRestoredLegalActions(restoredLock, 0);
    const probe = restoredLock.host.loadScript(
      `
      local dark=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkProbeCode}),0,LOCATION_HAND,0,nil)
      local light=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lightProbeCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("knightmare dark special " .. Duel.SpecialSummon(dark,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("knightmare light special " .. Duel.SpecialSummon(light,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "orcust-knightmare-dark-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restoredLock.host.messages.slice(-2)).toEqual(["knightmare dark special 1", "knightmare light special 0"]);
    expect(restoredLock.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createKnightmareSession() {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${knightmareCode}.lua`));
  const reader = createCardReader(cards());
  const session = createDuel({ seed: 4055337, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [knightmareCode, targetCode, sendCode, darkProbeCode, lightProbeCode] },
    1: { main: [] },
  });
  startDuel(session);
  return { workspace, reader, session };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Orcust Knightmare");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("return c:IsLinkMonster()");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_TOGRAVE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return not Duel.IsPlayerAffectedByEffect(tp,CARD_ORCUSTRATED_BABEL)");
  expect(script).toContain("return Duel.IsPlayerAffectedByEffect(tp,CARD_ORCUSTRATED_BABEL) and aux.StatChangeDamageStepCondition()");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(gc,REASON_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(lv*100)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_OATH)");
  expect(script).toContain("aux.RegisterClientHint(e:GetHandler(),nil,tp,1,0,aux.Stringid(id,2),nil)");
}

function cards(): DuelCardData[] {
  return [
    { code: knightmareCode, name: "Orcust Knightmare", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 7, attack: 100, defense: 2000 },
    { code: targetCode, name: "Orcust Knightmare Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: sendCode, name: "Orcust Knightmare Send Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 5, attack: 1500, defense: 1500 },
    { code: darkProbeCode, name: "Orcust Knightmare DARK Probe", kind: "monster", typeFlags: typeMonster, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: lightProbeCode, name: "Orcust Knightmare LIGHT Probe", kind: "monster", typeFlags: typeMonster, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", 0);
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  moved.faceUp = true;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
