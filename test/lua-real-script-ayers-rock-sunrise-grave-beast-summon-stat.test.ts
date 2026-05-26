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
const ayersCode = "42502956";
const reviveBeastCode = "425029560";
const graveBeastCode = "425029561";
const gravePlantCode = "425029562";
const graveWingedBeastCode = "425029563";
const opponentACode = "425029564";
const opponentBCode = "425029565";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasAyersScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ayersCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceWingedBeast = 0x200;
const racePlant = 0x400;
const raceBeast = 0x4000;
const attributeEarth = 0x1;
const attributeWind = 0x10;
const effectUpdateAttack = 100;
const effectFlagCannotDisable = 0x400;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasAyersScript)("Lua real script Ayers Rock Sunrise grave Beast summon stat", () => {
  it("restores grave Beast target summon and opponent ATK loss from remaining Beast Plant Winged Beast count", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${ayersCode}.lua`));
    const databaseAyers = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === ayersCode);
    expect(databaseAyers).toBeDefined();
    const reader = createCardReader([
      databaseAyers!,
      ...cards(),
    ]);

    const restored = createRestoredAyersField({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const ayers = requireCard(restored.session, ayersCode);
    const reviveBeast = requireCard(restored.session, reviveBeastCode);
    const graveBeast = requireCard(restored.session, graveBeastCode);
    const gravePlant = requireCard(restored.session, gravePlantCode);
    const graveWingedBeast = requireCard(restored.session, graveWingedBeastCode);
    const opponentA = requireCard(restored.session, opponentACode);
    const opponentB = requireCard(restored.session, opponentBCode);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === ayers.uid && action.effectId === "lua-1-1002"
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === ayers.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restored.session.state.cards.find((card) => card.uid === reviveBeast.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: ayers.uid,
      reasonEffectId: 1,
    });
    expect([graveBeast, gravePlant, graveWingedBeast].map((card) => restored.session.state.cards.find((candidate) => candidate.uid === card.uid)?.location)).toEqual([
      "graveyard",
      "graveyard",
      "graveyard",
    ]);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === opponentA.uid), restored.session.state)).toBe(1400);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === opponentB.uid), restored.session.state)).toBe(900);
    expect(restored.session.state.effects.filter((effect) =>
      [opponentA.uid, opponentB.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      property: effect.property,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: effectFlagCannotDisable, registryKey: `lua:${ayersCode}:lua-2-100`, reset: { flags: resetStandardPhaseEnd }, sourceUid: opponentA.uid, value: -600 },
      { code: effectUpdateAttack, property: effectFlagCannotDisable, registryKey: `lua:${ayersCode}:lua-3-100`, reset: { flags: resetStandardPhaseEnd }, sourceUid: opponentB.uid, value: -600 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["becameTarget", "specialSummoned", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: reviveBeast.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: reviveBeast.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: ayers.uid, eventReasonEffectId: 1, previous: "graveyard", current: "monsterZone" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: ayers.uid, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "spellTrapZone", current: "graveyard" },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === opponentA.uid), restoredStat.session.state)).toBe(1400);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === opponentB.uid), restoredStat.session.state)).toBe(900);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredAyersField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 42502956, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [ayersCode, reviveBeastCode, graveBeastCode, gravePlantCode, graveWingedBeastCode] },
    1: { main: [opponentACode, opponentBCode] },
  });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, ayersCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, reviveBeastCode).uid, "graveyard", 0);
  moveDuelCard(session.state, requireCard(session, graveBeastCode).uid, "graveyard", 0);
  moveDuelCard(session.state, requireCard(session, gravePlantCode).uid, "graveyard", 0);
  moveDuelCard(session.state, requireCard(session, graveWingedBeastCode).uid, "graveyard", 0);
  moveFaceUpAttack(session, requireCard(session, opponentACode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentBCode), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ayersCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Ayers Rock Sunrise");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("return c:IsRace(RACE_BEAST) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.GetMatchingGroupCount(Card.IsRace,tp,LOCATION_GRAVE,0,nil,RACE_BEAST|RACE_PLANT|RACE_WINGEDBEAST)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-atk)");
}

function cards(): DuelCardData[] {
  return [
    { code: reviveBeastCode, name: "Ayers Revive Beast", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: graveBeastCode, name: "Ayers Grave Beast", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 800, defense: 800 },
    { code: gravePlantCode, name: "Ayers Grave Plant", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeEarth, level: 4, attack: 700, defense: 700 },
    { code: graveWingedBeastCode, name: "Ayers Grave Winged Beast", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeWind, level: 4, attack: 900, defense: 900 },
    { code: opponentACode, name: "Ayers Opponent A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2000, defense: 1000 },
    { code: opponentBCode, name: "Ayers Opponent B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string, controller?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.controller === controller));
  expect(card).toBeDefined();
  return card!;
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
