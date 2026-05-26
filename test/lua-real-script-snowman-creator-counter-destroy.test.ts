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
const snowmanCode = "15893860";
const waterAllyACode = "158938600";
const waterAllyBCode = "158938601";
const opponentTargetCode = "158938602";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSnowmanScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${snowmanCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceAqua = 0x40;
const attributeWater = 0x2;
const counterIce = 0x1015;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSnowmanScript)("Lua real script Snowman Creator counter destroy", () => {
  it("restores WATER-count Ice Counter placement into optional BreakEffect destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${snowmanCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredSummon = createRestoredSummonState(reader, workspace);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const snowman = requireCard(restoredSummon.session, snowmanCode);
    const opponentTarget = requireCard(restoredSummon.session, opponentTargetCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === snowman.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader, {
      promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }],
    });
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === snowman.uid && action.effectId?.endsWith("-1100")
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo")).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 254301762, returned: true },
    ]);
    expect(findCard(restoredTrigger.session, opponentTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: snowman.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "counterAdded", "breakEffect", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: snowman.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: opponentTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: snowman.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: opponentTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: snowman.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: opponentTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: snowman.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: snowman.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: snowman.uid, eventReasonEffectId: 1, relatedEffectId: undefined },
    ]);
  });
});

function createRestoredSummonState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 15893860, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [snowmanCode, waterAllyACode, waterAllyBCode] }, 1: { main: [opponentTargetCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, snowmanCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, waterAllyACode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, waterAllyBCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentTargetCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerSnowman(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const snowman = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === snowmanCode);
  expect(snowman).toBeDefined();
  return [
    snowman!,
    { code: waterAllyACode, name: "Snowman Creator Water Ally A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
    { code: waterAllyBCode, name: "Snowman Creator Water Ally B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
    { code: opponentTargetCode, name: "Snowman Creator Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1500, defense: 1000 },
  ];
}

function registerSnowman(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(snowmanCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Snowman Creator");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER+CATEGORY_DESTROY)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_FLIP_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsAttribute,ATTRIBUTE_WATER),tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsAttribute,ATTRIBUTE_WATER),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("tc:AddCounter(0x1015,1)");
  expect(script).toContain("if ct>=3 and Duel.SelectYesNo(tp,aux.Stringid(id,2)) then");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.TRUE,tp,0,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.HintSelection(dg)");
  expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
