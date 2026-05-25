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
const dragonGateCode = "9567495";
const materialMonsterCode = "95674950";
const materialSpellCode = "95674951";
const materialTrapCode = "95674952";
const opponentFirstCode = "95674953";
const opponentSecondCode = "95674954";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDragonGateScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dragonGateCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const effectAttackAll = 193;

describe.skipIf(!hasUpstreamScripts || !hasDragonGateScript)("Lua real script Dragon Gate overlay type attack-all stat", () => {
  it("restores overlay detach into attack-all, operated-type self ATK gain, and opponent ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${dragonGateCode}.lua`));
    const reader = createCardReader(cards());
    const restored = createRestoredDragonGateSession({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const dragonGate = requireCard(restored.session, dragonGateCode);
    const materialMonster = requireCard(restored.session, materialMonsterCode);
    const materialSpell = requireCard(restored.session, materialSpellCode);
    const materialTrap = requireCard(restored.session, materialTrapCode);
    const opponentFirst = requireCard(restored.session, opponentFirstCode);
    const opponentSecond = requireCard(restored.session, opponentSecondCode);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === dragonGate.uid && candidate.effectId === "lua-3",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === dragonGate.uid)?.overlayUids).toEqual([materialSpell.uid, materialTrap.uid]);
    expect([materialMonster, materialSpell, materialTrap].map((material) => restored.session.state.cards.find((card) => card.uid === material.uid)).map((card) => ({
      uid: card?.uid,
      location: card?.location,
      reason: card?.reason,
      reasonPlayer: card?.reasonPlayer,
      reasonCardUid: card?.reasonCardUid,
      reasonEffectId: card?.reasonEffectId,
    }))).toEqual([
      { uid: materialMonster.uid, location: "graveyard", reason: duelReason.effect, reasonPlayer: 0, reasonCardUid: dragonGate.uid, reasonEffectId: 3 },
      { uid: materialSpell.uid, location: "overlay", reason: 0, reasonPlayer: 0, reasonCardUid: undefined, reasonEffectId: undefined },
      { uid: materialTrap.uid, location: "overlay", reason: 0, reasonPlayer: 0, reasonCardUid: undefined, reasonEffectId: undefined },
    ]);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === dragonGate.uid), restored.session.state)).toBe(4000);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === opponentFirst.uid), restored.session.state)).toBe(1500);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === opponentSecond.uid), restored.session.state)).toBe(800);
    expect(restored.session.state.effects.filter((effect) => [dragonGate.uid, opponentFirst.uid, opponentSecond.uid].includes(effect.sourceUid) && [effectAttackAll, effectUpdateAttack].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      description: effect.description,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectAttackAll, description: 153079922, property: 67109888, reset: { flags: 1107169792 }, sourceUid: dragonGate.uid, value: 1 },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === dragonGate.uid)?.attackModifier).toBe(1000);
    expect(restored.session.state.cards.find((card) => card.uid === opponentFirst.uid)?.attackModifier).toBe(-1000);
    expect(restored.session.state.cards.find((card) => card.uid === opponentSecond.uid)?.attackModifier).toBe(-1000);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: materialMonster.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: dragonGate.uid, eventReasonEffectId: 3 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === dragonGate.uid), restoredAfter.session.state)).toBe(4000);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === opponentFirst.uid), restoredAfter.session.state)).toBe(1500);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Dragon Gate");
  expect(script).toContain("Xyz.AddProcedure(c,nil,6,2,s.ovfilter,aux.Stringid(id,0),2,s.xyzop)");
  expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,EFFECT_FLAG_OATH,1)");
  expect(script).toContain("e0:SetCode(EFFECT_CANNOT_BE_XYZ_MATERIAL)");
  expect(script).toContain("e1:SetCode(EFFECT_ATTACK_ALL)");
  expect(script).toContain("c:RemoveOverlayCard(tp,1,c:GetOverlayCount(),REASON_EFFECT)>0");
  expect(script).toContain("Duel.GetOperatedGroup():GetClassCount(Card.GetMainCardType)");
  expect(script).toContain("c:UpdateAttack(atk,RESETS_STANDARD_DISABLE_PHASE_END)==atk");
  expect(script).toContain("tc:UpdateAttack(-atk,RESETS_STANDARD_PHASE_END,c)");
}

function cards(): DuelCardData[] {
  return [
    { code: dragonGateCode, name: "Dragon Gate", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDragon, attribute: attributeDark, level: 6, attack: 3000, defense: 2000, xyzMaterialCount: 2, xyzMaterialMax: 99 },
    { code: materialMonsterCode, name: "Dragon Gate Monster Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 6, attack: 1000, defense: 1000 },
    { code: materialSpellCode, name: "Dragon Gate Spell Material", kind: "spell", typeFlags: typeSpell },
    { code: materialTrapCode, name: "Dragon Gate Trap Material", kind: "trap", typeFlags: typeTrap },
    { code: opponentFirstCode, name: "Dragon Gate Opponent First", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2500, defense: 1000 },
    { code: opponentSecondCode, name: "Dragon Gate Opponent Second", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
  ];
}

function createRestoredDragonGateSession(
  { reader, workspace }: { reader: ReturnType<typeof createCardReader>; workspace: ReturnType<typeof createUpstreamNodeWorkspace> },
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 9567495, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialMonsterCode, materialSpellCode, materialTrapCode], extra: [dragonGateCode] }, 1: { main: [opponentFirstCode, opponentSecondCode] } });
  startDuel(session);
  const dragonGate = requireCard(session, dragonGateCode);
  moveFaceUpAttack(session, dragonGate, 0, 0);
  dragonGate.summonType = "xyz";
  dragonGate.customStatusMask = 0x8;
  attachOverlay(session, dragonGate, requireCard(session, materialMonsterCode), 0);
  attachOverlay(session, dragonGate, requireCard(session, materialSpellCode), 1);
  attachOverlay(session, dragonGate, requireCard(session, materialTrapCode), 2);
  moveFaceUpAttack(session, requireCard(session, opponentFirstCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentSecondCode), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dragonGateCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function attachOverlay(session: DuelSession, holder: DuelCardInstance, material: DuelCardInstance, sequence: number): void {
  const moved = moveDuelCard(session.state, material.uid, "overlay", holder.controller);
  moved.sequence = sequence;
  holder.overlayUids.push(material.uid);
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
