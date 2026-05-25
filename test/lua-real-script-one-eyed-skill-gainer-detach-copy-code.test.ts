import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const skillGainerCode = "75620895";
const materialCode = "756208950";
const targetXyzCode = "756208951";
const targetDecoyCode = "756208952";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSkillGainerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${skillGainerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceWarrior = 0x1;
const raceSpellcaster = 0x10;
const attributeLight = 0x10;
const attributeDark = 0x20;
const effectChangeCode = 114;
const effectFlagCannotDisable = 1024;
const effectFlagCardTarget = 16;
const effectFlagNoTurnReset = 0x400000;

describe.skipIf(!hasUpstreamScripts || !hasSkillGainerScript)("Lua real script One-Eyed Skill Gainer detach copy code", () => {
  it("restores targeted Xyz copy-code effect after detaching overlay cost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${skillGainerCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 75620895, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode], extra: [skillGainerCode] }, 1: { main: [targetDecoyCode], extra: [targetXyzCode] } });
    startDuel(session);

    const skillGainer = requireCard(session, skillGainerCode);
    const material = requireCard(session, materialCode);
    const targetXyz = requireCard(session, targetXyzCode);
    const targetDecoy = requireCard(session, targetDecoyCode);
    moveFaceUpAttack(session, skillGainer, 0, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0).sequence = 0;
    skillGainer.overlayUids.push(material.uid);
    moveFaceUpAttack(session, targetXyz, 1, 0);
    moveFaceUpAttack(session, targetDecoy, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(skillGainerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === skillGainer.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: skillGainer.uid },
      { category: 2097152, code: undefined, event: "ignition", property: effectFlagCardTarget | effectFlagNoTurnReset, range: ["monsterZone"], sourceUid: skillGainer.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === skillGainer.uid && candidate.effectId === "lua-2",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === skillGainer.uid)?.overlayUids).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: skillGainer.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === skillGainer.uid && effect.code === effectChangeCode).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeCode, property: effectFlagCannotDisable, reset: { flags: 33427456 }, sourceUid: skillGainer.uid, value: Number(targetXyzCode) },
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
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: material.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: skillGainer.uid, eventReasonEffectId: 2 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: targetXyz.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(restoredAfter.session.state.effects.filter((effect) => effect.sourceUid === skillGainer.uid && effect.code === effectChangeCode).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeCode, property: effectFlagCannotDisable, reset: { flags: 33427456 }, sourceUid: skillGainer.uid, value: Number(targetXyzCode) },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--One-Eyed Skill Gainer");
  expect(script).toContain("Xyz.AddProcedure(c,nil,4,3)");
  expect(script).toContain("c:EnableReviveLimit()");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_NO_TURN_RESET)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_XYZ)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("local code=tc:GetOriginalCode()");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_CODE)");
  expect(script).toContain("e1:SetValue(code)");
  expect(script).toContain("c:CopyEffect(code,RESET_EVENT|RESETS_STANDARD,1)");
}

function cards(): DuelCardData[] {
  return [
    { code: skillGainerCode, name: "One-Eyed Skill Gainer", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2500, defense: 2600, xyzMaterialCount: 3 },
    { code: materialCode, name: "Skill Gainer Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1200, defense: 1200 },
    { code: targetXyzCode, name: "Skill Gainer Target Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1900, defense: 1600, xyzMaterialCount: 2 },
    { code: targetDecoyCode, name: "Skill Gainer Non-Xyz Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1700, defense: 1400 },
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
