import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLeftScale, currentRightScale } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hitotCode = "21364070";
const scaleTargetCode = "213640700";
const yosenjuHandCode = "213640701";
const offSetHandCode = "213640702";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasHitotScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${hitotCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceBeast = 0x4000;
const attributeWind = 0x2000;
const setYosenju = 0xb3;
const effectCannotSpecialSummon = 22;
const effectChangeLeftScale = 135;
const effectChangeRightScale = 137;
const resetPhaseEnd = 0x40000200;
const resetsStandardPhaseEnd = 0x41fe1200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasHitotScript)("Lua real script Mayosenju Hitot PZone scale lock stat", () => {
  it("changes a targeted Yosenju scale to 11 and registers the Yosenju-only summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${hitotCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 21364070, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hitotCode, scaleTargetCode, yosenjuHandCode, offSetHandCode] }, 1: { main: [] } });
    startDuel(session);

    const hitot = requireCard(session, hitotCode);
    const scaleTarget = requireCard(session, scaleTargetCode);
    movePzone(session, scaleTarget, 0);
    movePzone(session, hitot, 1);
    moveDuelCard(session.state, requireCard(session, yosenjuHandCode).uid, "hand", 0);
    moveDuelCard(session.state, requireCard(session, offSetHandCode).uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hitotCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
      candidate.type === "activateEffect" && candidate.uid === hitot.uid && candidate.effectId === "lua-3"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(currentLeftScale(findCard(restored.session, scaleTarget.uid), restored.session.state)).toBe(11);
    expect(currentRightScale(findCard(restored.session, scaleTarget.uid), restored.session.state)).toBe(11);
    expect(restored.session.state.effects.filter((effect) =>
      effect.sourceUid === scaleTarget.uid && [effectChangeLeftScale, effectChangeRightScale].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeLeftScale, reset: { flags: resetsStandardPhaseEnd }, sourceUid: scaleTarget.uid, value: 11 },
      { code: effectChangeRightScale, reset: { flags: resetsStandardPhaseEnd }, sourceUid: scaleTarget.uid, value: 11 },
    ]);
    expect(restored.session.state.effects.filter((effect) =>
      effect.sourceUid === hitot.uid && effect.code === effectCannotSpecialSummon
    ).map((effect) => ({
      code: effect.code,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: effectCannotSpecialSummon, luaTargetDescriptor: `target:not-setcode:${setYosenju}`, property: 67110912, reset: { flags: resetPhaseEnd }, sourceUid: hitot.uid, targetRange: [1, 0] },
    ]);
    const summonLockProbe = restored.host.loadScript(
      `
      local yosenju=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${yosenjuHandCode}),0,LOCATION_HAND,0,nil)
      local off_set=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${offSetHandCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("hitot special lock " .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,yosenju)) .. "/" .. tostring(Duel.IsPlayerCanSpecialSummon(0,0,POS_FACEUP_ATTACK,0,off_set)))
      `,
      "mayosenju-hitot-special-lock-probe.lua",
    );
    expect(summonLockProbe.ok, summonLockProbe.error).toBe(true);
    expect(restored.host.messages).toContain("hitot special lock true/false");
    expect(restored.session.state.eventHistory.filter((event) =>
      ["becameTarget", "chainSolved"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: scaleTarget.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: undefined, eventCode: 1022, eventName: "chainSolved", eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const hitot = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === hitotCode);
  expect(hitot).toBeDefined();
  return [
    hitot!,
    { code: scaleTargetCode, name: "Mayosenju Hitot Scale Target", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceBeast, attribute: attributeWind, level: 4, attack: 1000, defense: 1000, leftScale: 3, rightScale: 3, setcodes: [setYosenju] },
    { code: yosenjuHandCode, name: "Mayosenju Hitot Yosenju Hand Probe", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeWind, level: 4, attack: 1500, defense: 1000, setcodes: [setYosenju] },
    { code: offSetHandCode, name: "Mayosenju Hitot Off-Set Hand Probe", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeWind, level: 4, attack: 1600, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Mayosenju Hitot");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsSetCard,tp,LOCATION_PZONE,0,1,1,nil,SET_YOSENJU)");
  expect(script).toContain("e0:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
  expect(script).toContain("e0:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("return not c:IsSetCard(SET_YOSENJU)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LSCALE)");
  expect(script).toContain("e1:SetValue(11)");
  expect(script).toContain("e2:SetCode(EFFECT_CHANGE_RSCALE)");
  expect(script).toContain("e6:SetCode(EVENT_TO_HAND)");
  expect(script).toContain("e7:SetCode(EVENT_TO_DECK)");
  expect(script).toContain("aux.GlobalCheck(s,function()");
  expect(script).toContain("ge1:SetOperation(aux.sumreg)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function movePzone(session: DuelSession, card: DuelCardInstance, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.sequence = sequence;
  moved.faceUp = true;
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
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
