import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLeftScale, currentRank, currentRightScale } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const xiangshengCode = "17086528";
const xyzTargetCode = "170865280";
const levelTargetCode = "170865281";
const attackTargetCode = "170865282";
const opponentFieldCode = "170865283";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasXiangshengScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${xiangshengCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const typeXyz = 0x800000;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectSetAttackFinal = 102;
const effectChangeRank = 133;
const effectChangeLeftScale = 135;
const effectChangeRightScale = 137;
const resetStandardPhaseEnd = 0x41fe1200;

describe.skipIf(!hasUpstreamScripts || !hasXiangshengScript)("Lua real script Xiangsheng Magician pzone rank final attack", () => {
  it("restores PZONE scale/rank targeting and monster-zone final ATK targeting", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${xiangshengCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 17086528, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [xiangshengCode, xiangshengCode, xyzTargetCode, levelTargetCode, attackTargetCode] },
      1: { main: [opponentFieldCode] },
    });
    startDuel(session);

    const xiangshengCards = requireCards(session, xiangshengCode, 2);
    const pzoneXiangsheng = xiangshengCards[0]!;
    const monsterXiangsheng = xiangshengCards[1]!;
    const xyzTarget = requireCard(session, xyzTargetCode);
    const levelTarget = requireCard(session, levelTargetCode);
    const attackTarget = requireCard(session, attackTargetCode);
    const opponentField = requireCard(session, opponentFieldCode);
    movePzone(session, pzoneXiangsheng, 0, 0);
    moveFaceUpAttack(session, monsterXiangsheng, 0, 0);
    moveFaceUpAttack(session, xyzTarget, 0, 1);
    moveFaceUpAttack(session, levelTarget, 0, 2);
    moveFaceUpAttack(session, attackTarget, 0, 3);
    moveFaceUpAttack(session, opponentField, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(xiangshengCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(currentLeftScale(restored.session.state.cards.find((card) => card.uid === pzoneXiangsheng.uid), restored.session.state)).toBe(4);
    expect(currentRightScale(restored.session.state.cards.find((card) => card.uid === pzoneXiangsheng.uid), restored.session.state)).toBe(4);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === pzoneXiangsheng.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: 320, event: "continuous", property: 263168, range: ["spellTrapZone"], sourceUid: pzoneXiangsheng.uid, value: 1241513984 },
      { category: undefined, code: 1002, event: "ignition", property: undefined, range: ["hand"], sourceUid: pzoneXiangsheng.uid, value: undefined },
      { category: undefined, code: undefined, event: "ignition", property: 16, range: ["spellTrapZone"], sourceUid: pzoneXiangsheng.uid, value: undefined },
      { category: undefined, code: effectChangeLeftScale, event: "continuous", property: 131072, range: ["spellTrapZone"], sourceUid: pzoneXiangsheng.uid, value: 4 },
      { category: undefined, code: effectChangeRightScale, event: "continuous", property: 131072, range: ["spellTrapZone"], sourceUid: pzoneXiangsheng.uid, value: 4 },
      { category: undefined, code: 200, event: "continuous", property: undefined, range: ["spellTrapZone"], sourceUid: pzoneXiangsheng.uid, value: undefined },
      { category: 2097152, code: undefined, event: "ignition", property: 16, range: ["monsterZone"], sourceUid: pzoneXiangsheng.uid, value: undefined },
    ]);

    const rankAction = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === pzoneXiangsheng.uid,
    );
    expect(rankAction, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, rankAction!);
    resolveRestoredChain(restored);

    expect(currentRank(restored.session.state.cards.find((card) => card.uid === xyzTarget.uid), restored.session.state)).toBe(7);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === xyzTarget.uid && effect.code === effectChangeRank).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeRank, property: undefined, reset: { flags: resetStandardPhaseEnd }, sourceUid: xyzTarget.uid, value: 7 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: xyzTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: levelTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
    ]);

    const attackAction = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === monsterXiangsheng.uid,
    );
    expect(attackAction, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, attackAction!);
    resolveRestoredChain(restored);

    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === monsterXiangsheng.uid), restored.session.state)).toBe(2100);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === monsterXiangsheng.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: undefined, reset: { flags: resetStandardPhaseEnd }, sourceUid: monsterXiangsheng.uid, value: 2100 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Xiangsheng Magician");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e2:SetRange(LOCATION_PZONE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.rkfilter,tp,LOCATION_MZONE,0,1,1,nil,tp)");
  expect(script).toContain("Duel.SelectTarget(tp,s.lvfilter,tp,LOCATION_MZONE,0,1,1,g:GetFirst(),g:GetFirst():GetRank())");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_RANK)");
  expect(script).toContain("e3:SetCode(EFFECT_CHANGE_LSCALE)");
  expect(script).toContain("e4:SetCode(EFFECT_CHANGE_RSCALE)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_ONFIELD,0)>Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD)");
  expect(script).toContain("e5:SetCode(EFFECT_NO_BATTLE_DAMAGE)");
  expect(script).toContain("e6:SetRange(LOCATION_MZONE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,c,atk)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: xiangshengCode, name: "Xiangsheng Magician", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 500, defense: 1500, leftScale: 8, rightScale: 8 },
    { code: xyzTargetCode, name: "Xiangsheng Xyz Rank Target", kind: "extra", typeFlags: typeMonster | typeXyz, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2100, defense: 1000 },
    { code: levelTargetCode, name: "Xiangsheng Level Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 7, attack: 1800, defense: 1000 },
    { code: attackTargetCode, name: "Xiangsheng Attack Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2400, defense: 1000 },
    { code: opponentFieldCode, name: "Xiangsheng Opponent Field Count", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
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

function movePzone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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
