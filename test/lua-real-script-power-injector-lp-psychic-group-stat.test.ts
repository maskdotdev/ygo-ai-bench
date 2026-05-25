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
const injectorCode = "89547299";
const allyPsychicCode = "895472990";
const opponentPsychicCode = "895472991";
const warriorDecoyCode = "895472992";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasInjectorScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${injectorCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const racePsychic = 0x100000;
const attributeLight = 0x10;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const effectFlagCannotDisable = 1024;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasInjectorScript)("Lua real script Power Injector LP psychic group stat", () => {
  it("restores LP cost into all face-up Psychic monster ATK boosts", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${injectorCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 89547299, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [injectorCode, allyPsychicCode, warriorDecoyCode] }, 1: { main: [opponentPsychicCode] } });
    startDuel(session);

    const injector = requireCard(session, injectorCode);
    const allyPsychic = requireCard(session, allyPsychicCode);
    const warriorDecoy = requireCard(session, warriorDecoyCode);
    const opponentPsychic = requireCard(session, opponentPsychicCode);
    moveFaceUpAttack(session, injector, 0, 0);
    moveFaceUpAttack(session, allyPsychic, 0, 1);
    moveFaceUpAttack(session, warriorDecoy, 0, 2);
    moveFaceUpAttack(session, opponentPsychic, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(injectorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === injector.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: 2097152, code: undefined, event: "ignition", property: undefined, range: ["monsterZone"], sourceUid: injector.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === injector.uid && candidate.effectId === "lua-1",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.players[0].lifePoints).toBe(7400);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === injector.uid), restored.session.state)).toBe(1800);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === allyPsychic.uid), restored.session.state)).toBe(2000);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === opponentPsychic.uid), restored.session.state)).toBe(2100);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === warriorDecoy.uid), restored.session.state)).toBe(1700);
    expect(restored.session.state.effects.filter((effect) => effect.code === effectUpdateAttack && [injector.uid, allyPsychic.uid, opponentPsychic.uid, warriorDecoy.uid].includes(effect.sourceUid ?? "")).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: effectFlagCannotDisable, reset: { flags: resetStandardPhaseEnd }, sourceUid: injector.uid, value: 500 },
      { code: effectUpdateAttack, property: effectFlagCannotDisable, reset: { flags: resetStandardPhaseEnd }, sourceUid: allyPsychic.uid, value: 500 },
      { code: effectUpdateAttack, property: effectFlagCannotDisable, reset: { flags: resetStandardPhaseEnd }, sourceUid: opponentPsychic.uid, value: 500 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "lifePointCostPaid", eventCode: 1201, eventCardUid: undefined, eventPlayer: 0, eventValue: 600, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: injector.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === opponentPsychic.uid), restoredAfter.session.state)).toBe(2100);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Power Injector");
  expect(script).toContain("e1:SetCost(Cost.PayLP(600))");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsRace,RACE_PSYCHIC),tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsRace,RACE_PSYCHIC),tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("for tc in aux.Next(g) do");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: injectorCode, name: "Power Injector", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeLight, level: 4, attack: 1300, defense: 1400 },
    { code: allyPsychicCode, name: "Power Injector Psychic Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeLight, level: 4, attack: 1500, defense: 1000 },
    { code: opponentPsychicCode, name: "Power Injector Opponent Psychic", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
    { code: warriorDecoyCode, name: "Power Injector Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
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
