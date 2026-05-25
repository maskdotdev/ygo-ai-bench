import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const frightfuloidCode = "34566435";
const graveFrightfurCode = "345664350";
const faceupNonFusionCode = "345664351";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasFrightfuloidScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${frightfuloidCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const setFrightfur = 0xad;
const effectFlagCardTarget = 16;
const effectSetAttackFinal = 102;
const effectSetDefenseFinal = 106;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasFrightfuloidScript)("Lua real script Edge Imp Frightfuloid grave Fusion final stat", () => {
  it("restores a graveyard Frightfur Fusion target into copied final ATK and DEF", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${frightfuloidCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 34566435, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [frightfuloidCode, faceupNonFusionCode], extra: [graveFrightfurCode] }, 1: { main: [] } });
    startDuel(session);

    const frightfuloid = requireCard(session, frightfuloidCode);
    const graveFrightfur = requireCard(session, graveFrightfurCode);
    const faceupNonFusion = requireCard(session, faceupNonFusionCode);
    moveFaceUpAttack(session, frightfuloid, 0, 0);
    moveDuelCard(session.state, graveFrightfur.uid, "graveyard", 0);
    const decoy = moveFaceUpAttack(session, faceupNonFusion, 0, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(frightfuloidCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === frightfuloid.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: 2097152, code: undefined, event: "ignition", property: effectFlagCardTarget, range: ["monsterZone"], sourceUid: frightfuloid.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === frightfuloid.uid && candidate.effectId === "lua-1",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.host.promptDecisions).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === graveFrightfur.uid)).toMatchObject({ location: "graveyard" });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === frightfuloid.uid), restored.session.state)).toBe(2800);
    expect(currentDefense(restored.session.state.cards.find((card) => card.uid === frightfuloid.uid), restored.session.state)).toBe(2100);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === decoy.uid), restored.session.state)).toBe(1700);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === frightfuloid.uid && [effectSetAttackFinal, effectSetDefenseFinal].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: undefined, reset: { flags: resetStandardPhaseEnd }, sourceUid: frightfuloid.uid, value: 2800 },
      { code: effectSetDefenseFinal, property: undefined, reset: { flags: resetStandardPhaseEnd }, sourceUid: frightfuloid.uid, value: 2100 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentDefense(restoredAfter.session.state.cards.find((card) => card.uid === frightfuloid.uid), restoredAfter.session.state)).toBe(2100);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Edge Imp Frightfuloid");
  expect(script).toContain("s.listed_series={SET_FRIGHTFUR}");
  expect(script).toContain("return (c:IsLocation(LOCATION_GRAVE) or c:IsFaceup()) and c:IsType(TYPE_FUSION) and c:IsSetCard(SET_FRIGHTFUR)");
  expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("tc:IsLocation(LOCATION_GRAVE) or tc:IsFaceup()");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetBaseAttack())");
  expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
  expect(script).toContain("e2:SetValue(tc:GetBaseDefense())");
}

function cards(): DuelCardData[] {
  return [
    { code: frightfuloidCode, name: "Edge Imp Frightfuloid", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1300, defense: 1300 },
    { code: graveFrightfurCode, name: "Frightfuloid Grave Frightfur Fusion", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceFiend, attribute: attributeDark, level: 8, attack: 2800, defense: 2100, setcodes: [setFrightfur] },
    { code: faceupNonFusionCode, name: "Frightfuloid Face-Up Non-Fusion Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000, setcodes: [setFrightfur] },
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
