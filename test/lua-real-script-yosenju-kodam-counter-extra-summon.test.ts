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
const kodamCode = "23740893";
const trainingGroundsCode = "27918963";
const yosenjuHandCode = "237408930";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasKodamScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${kodamCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeContinuous = 0x10000;
const raceBeastWarrior = 0x4000;
const attributeWind = 0x10;
const setYosenju = 0xb3;
const categoryCounter = 0x800000;
const counterYosen = 0x33;
const effectExtraSummonCount = 29;

describe.skipIf(!hasUpstreamScripts || !hasKodamScript)("Lua real script Yosenju Kodam counter extra summon", () => {
  it("restores SelfTribute targeting into Yosen Counter placement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectKodamScriptShape(workspace.readScript(`official/c${kodamCode}.lua`));
    const reader = createCardReader(cards());
    const session = setupCounterDuel(reader);
    const kodam = requireCard(session, kodamCode);
    const trainingGrounds = requireCard(session, trainingGroundsCode);
    registerScripts(session, workspace, [kodamCode, trainingGroundsCode]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === kodam.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: categoryCounter, code: undefined, countLimit: 1, event: "ignition", id: "lua-1", property: 16, range: ["monsterZone"] },
      { category: undefined, code: undefined, countLimit: undefined, event: "ignition", id: "lua-2", property: undefined, range: ["graveyard"] },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === kodam.uid && action.effectId === "lua-1"
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toHaveLength(0);
    expect(findCard(restoredOpen.session, kodam.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(getDuelCardCounter(findCard(restoredOpen.session, trainingGrounds.uid), counterYosen)).toBe(3);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["released", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: kodam.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: kodam.uid, eventReasonEffectId: 1 },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: trainingGrounds.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: kodam.uid, eventReasonEffectId: 1 },
    ]);
  });

  it("restores grave SelfBanish into temporary Yosenju extra Normal Summon count", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const reader = createCardReader(cards());
    const session = setupExtraSummonDuel(reader);
    const kodam = requireCard(session, kodamCode);
    const yosenju = requireCard(session, yosenjuHandCode);
    registerScripts(session, workspace, [kodamCode]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === kodam.uid && action.effectId === "lua-2"
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(findCard(restoredOpen.session, kodam.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: kodam.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === kodam.uid && effect.code === effectExtraSummonCount).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: effectExtraSummonCount, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], reset: { flags: 1073742336 }, targetRange: [2, 0] },
    ]);
    expect(restoredOpen.session.state.flagEffects.filter((flag) => flag.ownerType === "player" && flag.ownerId === "0" && flag.code === Number(kodamCode)).map((flag) => ({
      code: flag.code,
      ownerId: flag.ownerId,
      ownerType: flag.ownerType,
      property: flag.property,
      reset: flag.reset,
      resetCount: flag.resetCount,
      value: flag.value,
    }))).toEqual([
      { code: Number(kodamCode), ownerId: "0", ownerType: "player", property: 0, reset: 0x40000200, resetCount: 1, value: 0 },
    ]);

    const restoredExtraSummon = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredExtraSummon);
    expectRestoredLegalActions(restoredExtraSummon, 0);
    const summon = getLuaRestoreLegalActions(restoredExtraSummon, 0).find((action) => action.type === "normalSummon" && action.uid === yosenju.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredExtraSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredExtraSummon, summon!);
    expect(findCard(restoredExtraSummon.session, yosenju.uid)).toMatchObject({ location: "monsterZone", summonType: "normal" });
    expect(restoredExtraSummon.session.state.activityCounts[0].normalSummon).toBe(1);

    const probeHost = createLuaScriptHost(restoredExtraSummon.session, workspace);
    const probe = probeHost.loadScript(
      `
      local flag = Duel.GetFlagEffect(0, ${kodamCode})
      Debug.Message("kodam extra flag " .. flag)
    `,
      "kodam-flag-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(probeHost.messages).toEqual(["kodam extra flag 1"]);
  });
});

function setupCounterDuel(reader: ReturnType<typeof createCardReader>): DuelSession {
  const session = createDuel({ seed: 23740893, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [kodamCode, trainingGroundsCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, kodamCode), 0);
  const grounds = moveDuelCard(session.state, requireCard(session, trainingGroundsCode).uid, "spellTrapZone", 0);
  grounds.faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function setupExtraSummonDuel(reader: ReturnType<typeof createCardReader>): DuelSession {
  const session = createDuel({ seed: 23740894, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [kodamCode, yosenjuHandCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, kodamCode).uid, "graveyard", 0);
  moveDuelCard(session.state, requireCard(session, yosenjuHandCode).uid, "hand", 0);
    session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function registerScripts(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, codes: string[]): void {
  const host = createLuaScriptHost(session, workspace);
  for (const code of codes) expect(host.loadCardScript(Number(code), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(codes.length);
}

function expectKodamScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Yosenju Kodam");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCost(Cost.SelfTribute)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,0,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,3,0,0x33)");
  expect(script).toContain("tc:AddCounter(0x33,3)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return Duel.IsPlayerCanAdditionalSummon(tp)");
  expect(script).toContain("return Duel.IsPlayerCanSummon(tp)");
  expect(script).toContain("Duel.GetFlagEffect(tp,id)~=0");
  expect(script).toContain("e1:SetCode(EFFECT_EXTRA_SUMMON_COUNT)");
  expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_YOSENJU))");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,0,1)");
}

function cards(): DuelCardData[] {
  return [
    { code: kodamCode, name: "Yosenju Kodam", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeWind, setcodes: [setYosenju], level: 1, attack: 0, defense: 0 },
    { code: trainingGroundsCode, name: "Yosen Training Grounds", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setYosenju] },
    { code: yosenjuHandCode, name: "Yosenju Extra Summon Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeWind, setcodes: [setYosenju], level: 4, attack: 1600, defense: 1000 },
  ];
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
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
