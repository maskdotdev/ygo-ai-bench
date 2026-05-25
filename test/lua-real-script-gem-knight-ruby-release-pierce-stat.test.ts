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
const rubyCode = "76614340";
const gemCostCode = "766143400";
const nonGemDecoyCode = "766143401";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRubyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rubyCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const racePyro = 0x80;
const raceRock = 0x200000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeFire = 0x4;
const setGem = 0x47;
const setGemKnight = 0x1047;
const effectSpecialSummonCondition = 30;
const effectUpdateAttack = 100;
const effectPierce = 203;

describe.skipIf(!hasUpstreamScripts || !hasRubyScript)("Lua real script Gem-Knight Ruby release pierce stat", () => {
  it("restores Fusion metadata, pierce, and Gem release cost into ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${rubyCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 76614340, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gemCostCode, nonGemDecoyCode], extra: [rubyCode] }, 1: { main: [] } });
    startDuel(session);

    const ruby = requireCard(session, rubyCode);
    const gemCost = requireCard(session, gemCostCode);
    const nonGemDecoy = requireCard(session, nonGemDecoyCode);
    moveFaceUpAttack(session, ruby, 0, 0);
    moveFaceUpAttack(session, gemCost, 0, 1);
    moveFaceUpAttack(session, nonGemDecoy, 0, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rubyCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === ruby.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: ruby.uid },
      { category: undefined, code: effectSpecialSummonCondition, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: ruby.uid },
      { category: 2097152, code: undefined, event: "ignition", property: undefined, range: ["monsterZone"], sourceUid: ruby.uid },
      { category: undefined, code: effectPierce, event: "continuous", property: undefined, range: ["monsterZone"], sourceUid: ruby.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === ruby.uid && candidate.effectId === "lua-3",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === gemCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: ruby.uid,
      reasonEffectId: 3,
    });
    expect(restored.session.state.cards.find((card) => card.uid === nonGemDecoy.uid)).toMatchObject({ location: "monsterZone" });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === ruby.uid), restored.session.state)).toBe(3900);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === ruby.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { flags: 1107235328 }, sourceUid: ruby.uid, value: 1400 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: gemCost.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: ruby.uid, eventReasonEffectId: 3 },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: gemCost.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: ruby.uid, eventReasonEffectId: 3 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === ruby.uid), restoredAfter.session.state)).toBe(3900);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Gem-Knight Ruby");
  expect(script).toContain("Fusion.AddProcMix(c,false,false,91731841,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_GEM_KNIGHT))");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("return not e:GetHandler():IsLocation(LOCATION_EXTRA) or (st&SUMMON_TYPE_FUSION)==SUMMON_TYPE_FUSION");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_GEM)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.costfilter,1,false,nil,e:GetHandler())");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.costfilter,1,1,false,nil,e:GetHandler())");
  expect(script).toContain("e:SetLabel(rg:GetFirst():GetAttack())");
  expect(script).toContain("Duel.Release(rg,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(e:GetLabel())");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
  expect(script).toContain("e4:SetCode(EFFECT_PIERCE)");
}

function cards(): DuelCardData[] {
  return [
    { code: rubyCode, name: "Gem-Knight Ruby", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: racePyro, attribute: attributeEarth, level: 6, attack: 2500, defense: 1300, setcodes: [setGem, setGemKnight], fusionMaterialMin: 2, fusionMaterialMax: 2 },
    { code: gemCostCode, name: "Gem-Knight Ruby Gem Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeEarth, level: 4, attack: 1400, defense: 1000, setcodes: [setGem] },
    { code: nonGemDecoyCode, name: "Gem-Knight Ruby Non-Gem Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1900, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
