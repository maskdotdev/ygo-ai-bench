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
const crystalSharkCode = "98881700";
const waterTargetCode = "988817000";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCrystalSharkScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${crystalSharkCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFish = 0x400000;
const attributeWater = 0x2;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasCrystalSharkScript)("Lua real script Crystal Shark hand summon final stat", () => {
  it("restores hand target Special Summon into final ATK half, leave-field redirect, and Xyz Extra Deck restriction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${crystalSharkCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restored = createRestoredCrystalSharkOpen({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const crystalShark = requireCard(restored.session, crystalSharkCode);
    const waterTarget = requireCard(restored.session, waterTargetCode);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
      candidate.type === "activateEffect" && candidate.uid === crystalShark.uid && candidate.effectId === "lua-1"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === crystalShark.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: crystalShark.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === waterTarget.uid), restored.session.state)).toBe(1000);
    expect(restored.session.state.effects.filter((effect) => [crystalShark.uid, waterTarget.uid].includes(effect.sourceUid)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: undefined, reset: undefined, sourceUid: crystalShark.uid, targetRange: undefined, value: undefined },
      { code: 242, reset: undefined, sourceUid: crystalShark.uid, targetRange: undefined, value: undefined },
      { code: 22, reset: { flags: 1073742336 }, sourceUid: crystalShark.uid, targetRange: [1, 0], value: undefined },
      { code: 51476410, reset: { flags: 1073742336 }, sourceUid: crystalShark.uid, targetRange: [255, 0], value: 1 },
      { code: 60, reset: { flags: 209326080 }, sourceUid: crystalShark.uid, targetRange: undefined, value: 32 },
      { code: effectSetAttackFinal, reset: { flags: 33427456 }, sourceUid: waterTarget.uid, targetRange: undefined, value: 1000 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["becameTarget", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: waterTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: crystalShark.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: crystalShark.uid,
        eventReasonEffectId: 1,
        eventUids: [crystalShark.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: crystalSharkCode, name: "Crystal Shark", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, attribute: attributeWater, level: 5, attack: 1100, defense: 800 },
    { code: waterTargetCode, name: "Crystal Shark WATER Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, attribute: attributeWater, level: 4, attack: 2000, defense: 1000 },
  ];
}

function createRestoredCrystalSharkOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 98881700, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [crystalSharkCode, waterTargetCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, crystalSharkCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, waterTargetCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(crystalSharkCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Crystal Shark");
  expect(script).toContain("e1:SetRange(LOCATION_HAND|LOCATION_GRAVE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,s.cfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.RegisterEffect(e0,tp)");
  expect(script).toContain("aux.addTempLizardCheck(c,tp,s.lizfilter)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e2:SetValue(tc:GetAttack()/2)");
  expect(script).toContain("return not c:IsType(TYPE_XYZ) and c:IsLocation(LOCATION_EXTRA)");
  expect(script).toContain("e2:SetCode(EFFECT_XYZ_LEVEL)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
  while (restored.session.state.chain.length > 0 && guard < 10) {
    guard += 1;
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
  expect(guard).toBeLessThan(10);
}
