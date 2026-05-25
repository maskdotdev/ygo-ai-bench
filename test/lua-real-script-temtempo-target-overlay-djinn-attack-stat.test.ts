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
const temtempoCode = "52558805";
const ownMaterialCode = "525588050";
const opponentXyzCode = "525588051";
const opponentMaterialCode = "525588052";
const djinnAllyCode = "525588053";
const nonDjinnCode = "525588054";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTemtempoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${temtempoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeWind = 0x8;
const setDjinn = 0x6d;
const effectFlagCannotDisable = 1024;
const effectFlagCardTarget = 16;
const effectFlagDamageStep = 16384;
const effectUpdateAttack = 100;
const resetStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasTemtempoScript)("Lua real script Temtempo target overlay Djinn attack stat", () => {
  it("restores targeted opponent overlay removal into all friendly Djinn Xyz ATK gains", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${temtempoCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 52558805, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [ownMaterialCode, djinnAllyCode, nonDjinnCode], extra: [temtempoCode] },
      1: { main: [opponentMaterialCode], extra: [opponentXyzCode] },
    });
    startDuel(session);

    const temtempo = requireCard(session, temtempoCode);
    const ownMaterial = requireCard(session, ownMaterialCode);
    const opponentXyz = requireCard(session, opponentXyzCode);
    const opponentMaterial = requireCard(session, opponentMaterialCode);
    const djinnAlly = requireCard(session, djinnAllyCode);
    const nonDjinn = requireCard(session, nonDjinnCode);
    moveFaceUpAttack(session, temtempo, 0, 0);
    moveDuelCard(session.state, ownMaterial.uid, "overlay", 0);
    temtempo.overlayUids.push(ownMaterial.uid);
    moveFaceUpAttack(session, opponentXyz, 1, 0);
    moveDuelCard(session.state, opponentMaterial.uid, "overlay", 1);
    opponentXyz.overlayUids.push(opponentMaterial.uid);
    moveFaceUpAttack(session, djinnAlly, 0, 1);
    moveFaceUpAttack(session, nonDjinn, 0, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(temtempoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === temtempo.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: temtempo.uid },
      { category: 2097152, code: 1002, event: "quick", property: effectFlagCardTarget | effectFlagDamageStep, range: ["monsterZone"], sourceUid: temtempo.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === temtempo.uid && candidate.effectId === "lua-2-1002",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === ownMaterial.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: temtempo.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.cards.find((card) => card.uid === opponentMaterial.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: temtempo.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.cards.find((card) => card.uid === temtempo.uid)?.overlayUids).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === opponentXyz.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === temtempo.uid), restored.session.state)).toBe(2200);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === djinnAlly.uid), restored.session.state)).toBe(1800);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === nonDjinn.uid), restored.session.state)).toBe(1800);
    expect(restored.session.state.effects.filter((effect) =>
      [temtempo.uid, djinnAlly.uid, nonDjinn.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: effectFlagCannotDisable, reset: { flags: resetStandard }, sourceUid: temtempo.uid, value: 500 },
      { code: effectUpdateAttack, property: effectFlagCannotDisable, reset: { flags: resetStandard }, sourceUid: djinnAlly.uid, value: 500 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["detachedMaterial", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: ownMaterial.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: temtempo.uid, eventReasonEffectId: 2 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: opponentXyz.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: opponentMaterial.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: temtempo.uid, eventReasonEffectId: 2 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Temtempo the Percussion Djinn");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1,1,nil))");
  expect(script).toContain("return c:CheckRemoveOverlayCard(tp,1,REASON_EFFECT)");
  expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_XYZ) and c:IsSetCard(SET_DJINN)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil,tp)");
  expect(script).toContain("tc:RemoveOverlayCard(tp,1,1,REASON_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
}

function cards(): DuelCardData[] {
  return [
    { code: temtempoCode, name: "Temtempo the Percussion Djinn", kind: "extra", typeFlags: typeMonster | typeXyz, race: raceFiend, attribute: attributeEarth, level: 3, attack: 1700, defense: 1000, setcodes: [setDjinn] },
    { code: ownMaterialCode, name: "Temtempo Material", kind: "monster", typeFlags: typeMonster, race: raceFiend, attribute: attributeEarth, level: 3, attack: 1200, defense: 1000 },
    { code: opponentXyzCode, name: "Temtempo Opponent Xyz", kind: "extra", typeFlags: typeMonster | typeXyz, race: raceWarrior, attribute: attributeWind, level: 4, attack: 2000, defense: 1000 },
    { code: opponentMaterialCode, name: "Temtempo Opponent Material", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeWind, level: 4, attack: 1300, defense: 1000 },
    { code: djinnAllyCode, name: "Temtempo Djinn Ally", kind: "extra", typeFlags: typeMonster | typeXyz, race: raceFiend, attribute: attributeEarth, level: 3, attack: 1300, defense: 1000, setcodes: [setDjinn] },
    { code: nonDjinnCode, name: "Temtempo Non-Djinn Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
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
