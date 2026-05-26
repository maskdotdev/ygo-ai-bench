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
const cloudyCode = "53956001";
const weatherPainterCode = "539560010";
const targetCode = "539560011";
const offColumnWeatherCode = "539560012";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasCloudyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cloudyCode}.lua`));
const setTheWeather = 0x109;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const effectDirectAttack = 74;
const effectSetAttackFinal = 102;
const effectFlagClientHint = 0x4000000;
const resetsStandardPhaseEnd = 0x41fe1200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasCloudyScript)("Lua real script The Weather Cloudy Canvas grant banish direct stat", () => {
  it("restores Canvas-granted Weather quick self-banish into direct attack and final ATK halve", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cloudyCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 53956001, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cloudyCode, weatherPainterCode, targetCode, offColumnWeatherCode] }, 1: { main: [] } });
    startDuel(session);

    const cloudy = requireCard(session, cloudyCode);
    const weatherPainter = requireCard(session, weatherPainterCode);
    const target = requireCard(session, targetCode);
    const offColumnWeather = requireCard(session, offColumnWeatherCode);
    moveFaceUpSpell(session, cloudy, 1);
    moveFaceUpMonster(session, weatherPainter, 0, 0);
    moveFaceUpMonster(session, target, 0, 2);
    moveFaceUpMonster(session, offColumnWeather, 0, 4);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    const loaded = host.loadCardScript(Number(cloudyCode), workspace);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === cloudy.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      id: effect.id,
      range: effect.range,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: 1002, event: "ignition", id: "lua-1-1002", range: ["hand", "spellTrapZone"], targetRange: undefined },
      { code: undefined, event: "continuous", id: "lua-3", range: ["spellTrapZone"], targetRange: [4, 0] },
      { code: 1002, event: "quick", id: "lua-2-1002", range: ["monsterZone"], targetRange: undefined },
    ]);

    const granted = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === weatherPainter.uid
    );
    expect(granted, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(granted).toMatchObject({ effectId: "lua-2-1002" });
    expect(getLuaRestoreLegalActions(restored, 0).some((action) =>
      action.type === "activateEffect" && action.uid === offColumnWeather.uid
    )).toBe(false);
    applyRestoredActionAndAssert(restored, granted!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, weatherPainter.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: weatherPainter.uid,
    });
    expect(currentAttack(findCard(restored.session, target.uid), restored.session.state)).toBe(1000);
    expect(restored.session.state.effects.filter((effect) =>
      effect.sourceUid === target.uid && [effectDirectAttack, effectSetAttackFinal].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectDirectAttack, property: effectFlagClientHint, range: ["monsterZone"], reset: { flags: resetsStandardPhaseEnd }, sourceUid: target.uid, value: undefined },
      { code: effectSetAttackFinal, property: undefined, range: ["monsterZone"], reset: { flags: resetsStandardPhaseEnd }, sourceUid: target.uid, value: 1000 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) =>
      ["banished", "becameTarget"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: weatherPainter.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: weatherPainter.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "monsterZone", current: "banished" },
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", current: "monsterZone" },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const cloudy = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === cloudyCode);
  expect(cloudy).toBeDefined();
  return [
    { ...cloudy!, kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setTheWeather] },
    { code: weatherPainterCode, name: "Cloudy Canvas Weather Painter", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setTheWeather], level: 3, attack: 1600, defense: 400 },
    { code: targetCode, name: "Cloudy Canvas Face-up Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2000, defense: 1000 },
    { code: offColumnWeatherCode, name: "Cloudy Canvas Off-Column Weather", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setTheWeather], level: 3, attack: 1500, defense: 500 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("c:SetUniqueOnField(1,0,id)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e2:SetCost(s.announcecost)");
  expect(script).toContain("aux.bfgcost(e,tp,eg,ep,ev,re,r,rp,chk)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_GRANT)");
  expect(script).toContain("e3:SetRange(LOCATION_SZONE)");
  expect(script).toContain("e3:SetTargetRange(LOCATION_MZONE,0)");
  expect(script).toContain("e3:SetLabelObject(e2)");
  expect(script).toContain("c:IsType(TYPE_EFFECT) and c:IsSetCard(SET_THE_WEATHER)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_DIRECT_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e2:SetValue(atk)");
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

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
