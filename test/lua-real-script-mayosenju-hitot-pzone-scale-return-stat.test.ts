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
const hitotCode = "21364070";
const pzoneYosenjuCode = "213640700";
const allyYosenjuCode = "213640701";
const opponentTargetCode = "213640702";
const decoyCode = "213640703";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHitotScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${hitotCode}.lua`));
const setYosenju = 0xb3;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceBeastWarrior = 0x400000;
const attributeWind = 0x10;
const effectCannotSpecialSummon = 22;
const effectUpdateAttack = 100;
const effectChangeLScale = 135;
const effectChangeRScale = 137;
const effectCannotDisable = 1024;

describe.skipIf(!hasUpstreamScripts || !hasHitotScript)("Lua real script Mayosenju Hitot PZone scale return stat", () => {
  it("restores PZone scale changes and summon bounce ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${hitotCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const pzone = createRestoredPzoneOpen(workspace, reader);
    expectCleanRestore(pzone.restored);
    expectRestoredLegalActions(pzone.restored, 0);
    const scaleChange = getLuaRestoreLegalActions(pzone.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === pzone.hitot.uid
    );
    expect(scaleChange, JSON.stringify(getLuaRestoreLegalActions(pzone.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(pzone.restored, scaleChange!);
    resolveRestoredChain(pzone.restored);
    expect(pzone.restored.session.state.effects.filter((effect) =>
      effect.sourceUid === pzone.hitot.uid && [effectChangeLScale, effectChangeRScale].includes(effect.code ?? 0)
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeLScale, reset: { flags: 1107169792 }, sourceUid: pzone.hitot.uid, value: 11 },
      { code: effectChangeRScale, reset: { flags: 1107169792 }, sourceUid: pzone.hitot.uid, value: 11 },
    ]);
    expect(pzone.restored.session.state.effects.filter((effect) => effect.sourceUid === pzone.hitot.uid && effect.code === effectCannotSpecialSummon).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: effectCannotSpecialSummon, property: 67110912, reset: { flags: 1073742336 }, sourceUid: pzone.hitot.uid, targetRange: [1, 0] },
    ]);
    expect(pzone.restored.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: pzone.hitot.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 3 },
    ]);

    const summon = createRestoredSummonOpen(workspace, reader);
    expectCleanRestore(summon.restored);
    expectRestoredLegalActions(summon.restored, 0);
    const normalSummon = getLuaRestoreLegalActions(summon.restored, 0).find((action) =>
      action.type === "normalSummon" && action.uid === summon.hitot.uid
    );
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(summon.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(summon.restored, normalSummon!);
    const bounce = getLuaRestoreLegalActions(summon.restored, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === summon.hitot.uid && action.effectId === "lua-6-1100"
    );
    expect(bounce, JSON.stringify(getLuaRestoreLegalActions(summon.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(summon.restored, bounce!);
    resolveRestoredChain(summon.restored);
    expect(findCard(summon.restored.session, summon.opponentTarget.uid)).toMatchObject({
      location: "hand",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: summon.hitot.uid,
      reasonEffectId: 6,
    });
    const boost = getLuaRestoreLegalActions(summon.restored, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === summon.hitot.uid && action.effectId === "lua-8-1012"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(summon.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(summon.restored, boost!);
    resolveRestoredChain(summon.restored);
    expect(currentAttack(findCard(summon.restored.session, summon.hitot.uid), summon.restored.session.state)).toBe(2500);
    expect(currentAttack(findCard(summon.restored.session, summon.ally.uid), summon.restored.session.state)).toBe(1300);
    expect(currentAttack(findCard(summon.restored.session, summon.decoy.uid), summon.restored.session.state)).toBe(900);
    expect(summon.restored.session.state.effects.filter((effect) =>
      [summon.hitot.uid, summon.ally.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    })).sort((a, b) => a.sourceUid.localeCompare(b.sourceUid))).toEqual([
      { code: effectUpdateAttack, property: effectCannotDisable, reset: { flags: 33427456 }, sourceUid: summon.hitot.uid, value: 500 },
      { code: effectUpdateAttack, property: effectCannotDisable, reset: { flags: 33427456 }, sourceUid: summon.ally.uid, value: 500 },
    ]);
    expect(summon.restored.session.state.eventHistory.filter((event) =>
      ["normalSummoned", "becameTarget", "sentToHand"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: summon.hitot.uid, eventCode: 1100, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: summon.opponentTarget.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: summon.opponentTarget.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: summon.hitot.uid, eventReasonEffectId: 6, eventReasonPlayer: 0 },
    ]);
    expect(summon.restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: hitotCode, name: "Mayosenju Hitot", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceBeastWarrior, attribute: attributeWind, setcodes: [setYosenju], level: 4, attack: 2000, defense: 1000, leftScale: 3, rightScale: 3 },
    { code: pzoneYosenjuCode, name: "Mayosenju PZone Fixture", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceBeastWarrior, attribute: attributeWind, setcodes: [setYosenju], level: 4, attack: 1000, defense: 1000, leftScale: 4, rightScale: 4 },
    { code: allyYosenjuCode, name: "Yosenju Ally Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeWind, setcodes: [setYosenju], level: 4, attack: 800, defense: 1000 },
    { code: opponentTargetCode, name: "Opponent Return Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeWind, level: 4, attack: 1200, defense: 1000 },
    { code: decoyCode, name: "Non-Yosenju Decoy Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeWind, level: 4, attack: 900, defense: 1000 },
  ];
}

function createRestoredPzoneOpen(
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
): {
  hitot: DuelCardInstance;
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
  target: DuelCardInstance;
} {
  const session = createDuel({ seed: 21364070, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [hitotCode, pzoneYosenjuCode] }, 1: { main: [] } });
  startDuel(session);
  const hitot = requireCard(session, hitotCode);
  const target = requireCard(session, pzoneYosenjuCode);
  movePzone(session, hitot, 0, 0);
  movePzone(session, target, 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(hitotCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return { hitot, restored: restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader), target };
}

function createRestoredSummonOpen(
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
): {
  ally: DuelCardInstance;
  decoy: DuelCardInstance;
  hitot: DuelCardInstance;
  opponentTarget: DuelCardInstance;
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
} {
  const session = createDuel({ seed: 21364071, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [hitotCode, allyYosenjuCode, decoyCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  const hitot = requireCard(session, hitotCode);
  const ally = requireCard(session, allyYosenjuCode);
  const decoy = requireCard(session, decoyCode);
  const opponentTarget = requireCard(session, opponentTargetCode);
  moveDuelCard(session.state, hitot.uid, "hand", 0);
  moveFaceUpMonster(session, ally, 0, 0);
  moveFaceUpMonster(session, decoy, 0, 1);
  moveFaceUpMonster(session, opponentTarget, 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(hitotCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return { ally, decoy, hitot, opponentTarget, restored: restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader) };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Mayosenju Hitot");
  expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsSetCard,tp,LOCATION_PZONE,0,1,1,nil,SET_YOSENJU)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LSCALE)");
  expect(script).toContain("e2:SetCode(EFFECT_CHANGE_RSCALE)");
  expect(script).toContain("e4:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToHand,tp,0,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("e6:SetCode(EVENT_TO_HAND)");
  expect(script).toContain("e7:SetCode(EVENT_TO_DECK)");
  expect(script).toContain("tc:RegisterEffect(e1)");
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

function movePzone(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
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
