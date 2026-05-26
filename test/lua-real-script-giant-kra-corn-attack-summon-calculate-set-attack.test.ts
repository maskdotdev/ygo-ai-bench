import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const kraCornCode = "8170654";
const attackerCode = "81706540";
const plantAllyCode = "81706541";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasKraCornScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${kraCornCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePlant = 0x400;
const attributeEarth = 0x1;
const effectSetAttack = 101;

describe.skipIf(!hasUpstreamScripts || !hasKraCornScript)("Lua real script Giant Kra-Corn attack summon calculate set attack", () => {
  it("restores attack-announce hand summon CalculateDamage and targeted shared original-ATK set", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${kraCornCode}.lua`);
    expectKraCornScriptShape(script);
    const reader = createCardReader(cards());

    const restoredAttack = createRestoredAttack({ reader, workspace });
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 1);
    const handKraCorn = requireCard(restoredAttack.session, kraCornCode);
    const attacker = requireCard(restoredAttack.session, attackerCode);
    const directAttack = getLuaRestoreLegalActions(restoredAttack, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === undefined
    );
    expect(directAttack, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, directAttack!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredAttack.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const summon = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === handKraCorn.uid && action.effectId === "lua-1-1130"
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, summon!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.currentAttack).toBeUndefined();
    expect(restoredTrigger.session.state.pendingBattle).toBeUndefined();
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredTrigger.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === handKraCorn.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: attacker.uid,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "battleDestroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: handKraCorn.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: handKraCorn.uid, eventReasonEffectId: 1 },
      { eventName: "battleDestroyed", eventCode: 1140, eventCardUid: handKraCorn.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: attacker.uid, eventReasonEffectId: 1 },
    ]);

    const restoredSetAttack = createRestoredSetAttack({ reader, workspace });
    expectCleanRestore(restoredSetAttack);
    expectRestoredLegalActions(restoredSetAttack, 0);
    const fieldKraCorn = requireCard(restoredSetAttack.session, kraCornCode);
    const plantAlly = requireCard(restoredSetAttack.session, plantAllyCode);
    const setAttack = getLuaRestoreLegalActions(restoredSetAttack, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fieldKraCorn.uid && action.effectId === "lua-2"
    );
    expect(setAttack, JSON.stringify(getLuaRestoreLegalActions(restoredSetAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetAttack, setAttack!);
    resolveRestoredChain(restoredSetAttack);
    expect(currentAttack(restoredSetAttack.session.state.cards.find((card) => card.uid === fieldKraCorn.uid), restoredSetAttack.session.state)).toBe(2600);
    expect(currentAttack(restoredSetAttack.session.state.cards.find((card) => card.uid === plantAlly.uid), restoredSetAttack.session.state)).toBe(2600);
    expect(restoredSetAttack.session.state.effects.filter((effect) => effect.code === effectSetAttack && [fieldKraCorn.uid, plantAlly.uid].includes(effect.sourceUid ?? "")).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttack, property: 1024, reset: { flags: 33427456 }, sourceUid: fieldKraCorn.uid, value: 2600 },
      { code: effectSetAttack, property: 1024, reset: { flags: 33427456 }, sourceUid: plantAlly.uid, value: 2600 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: kraCornCode, name: "Giant Kra-Corn", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeEarth, level: 8, attack: 1000, defense: 1200 },
    { code: attackerCode, name: "Giant Kra-Corn Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2000, defense: 1000 },
    { code: plantAllyCode, name: "Giant Kra-Corn Plant Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
  ];
}

function createRestoredAttack({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 8170654, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [kraCornCode] }, 1: { main: [attackerCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, kraCornCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(kraCornCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredSetAttack({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 8170655, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [kraCornCode, plantAllyCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, kraCornCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, plantAllyCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(kraCornCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectKraCornScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Giant Kra-Corn");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("Duel.CalculateDamage(ac,c)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,c,atk,original_atk)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK)");
  expect(script).toContain("e1:SetValue(c:GetBaseAttack()+tc:GetBaseAttack())");
  expect(script).toContain("local e2=e1:Clone()");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
  const waitingFor = response.state.waitingFor;
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
