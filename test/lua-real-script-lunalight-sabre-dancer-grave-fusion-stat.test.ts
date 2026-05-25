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
const sabreCode = "88753594";
const ownGraveCode = "887535940";
const opponentGraveCode = "887535941";
const ownBanishedCode = "887535942";
const nonBeastWarriorCode = "887535943";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSabreScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sabreCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceBeastWarrior = 0x8000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const setLunalight = 0xdf;
const effectUpdateAttack = 100;
const effectCannotBeEffectTarget = 71;
const effectFlagSingleRange = 131072;
const resetStandardPhaseEnd = 0x41fe1200;

describe.skipIf(!hasUpstreamScripts || !hasSabreScript)("Lua real script Lunalight Sabre Dancer grave fusion stat", () => {
  it("restores continuous Beast-Warrior grave/banished ATK and grave SelfBanish Fusion boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${sabreCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 88753594, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [ownGraveCode, ownBanishedCode, nonBeastWarriorCode], extra: [sabreCode, sabreCode] },
      1: { main: [opponentGraveCode] },
    });
    startDuel(session);

    const [fieldSabre, graveSabre] = requireCards(session, sabreCode, 2);
    const ownGrave = requireCard(session, ownGraveCode);
    const opponentGrave = requireCard(session, opponentGraveCode);
    const ownBanished = requireCard(session, ownBanishedCode);
    const nonBeastWarrior = requireCard(session, nonBeastWarriorCode);
    moveFaceUpAttack(session, fieldSabre, 0, 0);
    moveDuelCard(session.state, graveSabre.uid, "graveyard", 0).turnId = 0;
    moveDuelCard(session.state, ownGrave.uid, "graveyard", 0);
    moveDuelCard(session.state, opponentGrave.uid, "graveyard", 1);
    const banished = moveDuelCard(session.state, ownBanished.uid, "banished", 0);
    banished.faceUp = true;
    moveDuelCard(session.state, nonBeastWarrior.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sabreCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(fieldSabre.data).toMatchObject({ fusionMaterialMin: 3, fusionMaterialMax: 3, fusionMaterialSetcode: setLunalight });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.cards.find((card) => card.uid === fieldSabre.uid)?.data).toMatchObject({
      fusionMaterialMin: 3,
      fusionMaterialMax: 3,
      fusionMaterialSetcode: setLunalight,
    });
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === fieldSabre.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: fieldSabre.uid, value: undefined },
      { category: undefined, code: 30, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: fieldSabre.uid, value: undefined },
      { category: undefined, code: effectUpdateAttack, event: "continuous", property: effectFlagSingleRange, range: ["monsterZone"], sourceUid: fieldSabre.uid, value: undefined },
      { category: undefined, code: effectCannotBeEffectTarget, event: "continuous", property: effectFlagSingleRange, range: ["monsterZone"], sourceUid: fieldSabre.uid, value: undefined },
      { category: 2097152, code: undefined, event: "ignition", property: 16, range: ["graveyard"], sourceUid: fieldSabre.uid, value: undefined },
    ]);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === fieldSabre.uid), restored.session.state)).toBe(3800);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === graveSabre.uid,
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const activatedEffectId = Number(action!.effectId.replace("lua-", ""));
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === graveSabre.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveSabre.uid,
      reasonEffectId: activatedEffectId,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === fieldSabre.uid), restored.session.state)).toBe(6800);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === nonBeastWarrior.uid), restored.session.state)).toBe(1800);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === fieldSabre.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: effectFlagSingleRange, reset: undefined, sourceUid: fieldSabre.uid, value: undefined },
      { code: effectUpdateAttack, property: undefined, reset: { flags: resetStandardPhaseEnd }, sourceUid: fieldSabre.uid, value: 3000 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["banished", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: graveSabre.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: graveSabre.uid, eventReasonEffectId: activatedEffectId },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: fieldSabre.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === fieldSabre.uid), restoredAfter.session.state)).toBe(6800);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Lunalight Sabre Dancer");
  expect(script).toContain("Fusion.AddProcMixN(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_LUNALIGHT),3)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetValue(s.atkval)");
  expect(script).toContain("e3:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
  expect(script).toContain("e3:SetValue(aux.tgoval)");
  expect(script).toContain("e4:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.GetMatchingGroupCount(s.atkfilter,c:GetControler(),LOCATION_GRAVE|LOCATION_REMOVED,LOCATION_GRAVE|LOCATION_REMOVED,nil)*200");
  expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_FUSION)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter2,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetValue(3000)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: sabreCode, name: "Lunalight Sabre Dancer", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceBeastWarrior, attribute: attributeDark, level: 9, attack: 3000, defense: 2600, setcodes: [setLunalight] },
    { code: ownGraveCode, name: "Sabre Dancer Own Grave Beast-Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 1400, defense: 1000, setcodes: [setLunalight] },
    { code: opponentGraveCode, name: "Sabre Dancer Opponent Grave Beast-Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
    { code: ownBanishedCode, name: "Sabre Dancer Face-Up Banished Beast-Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
    { code: nonBeastWarriorCode, name: "Sabre Dancer Non-Beast-Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function requireCards(session: DuelSession, code: string, count: number): DuelCardInstance[] {
  const cards = session.state.cards.filter((candidate) => candidate.code === code);
  expect(cards).toHaveLength(count);
  return cards;
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
