import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const goddessCode = "67959180";
const hasGoddessScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${goddessCode}.lua`));
const categoryCoin = 0x1000000;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasGoddessScript)("Lua real script Goddess of Whim coin final attack", () => {
  it("restores ignition CallCoin into heads double-ATK and tails half-ATK final stat branches", () => {
    const heads = resolveWhim(10);
    expect(heads.session.state.lastCoinResults).toEqual([1]);
    expect(currentAttack(heads.card, heads.session.state)).toBe(1900);
    expectFinalAttackEffect(heads.session, heads.card, 1900);
    expectCoinEvent(heads.session, heads.card, 1);

    const tails = resolveWhim(1);
    expect(tails.session.state.lastCoinResults).toEqual([0]);
    expect(currentAttack(tails.card, tails.session.state)).toBe(475);
    expectFinalAttackEffect(tails.session, tails.card, 475);
    expectCoinEvent(tails.session, tails.card, 1);
  });
});

function resolveWhim(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const script = workspace.readScript(`official/c${goddessCode}.lua`);
  expectScriptShape(script);
  const cardData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === goddessCode);
  expect(cardData).toBeDefined();
  const reader = createCardReader([cardData!]);
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [goddessCode] }, 1: { main: [] } });
  startDuel(session);

  const goddess = requireCard(session, goddessCode);
  moveFaceUpAttack(session, goddess, 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(goddessCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  expect(restored.session.state.effects.filter((effect) => effect.sourceUid === goddess.uid).map((effect) => ({
    category: effect.category,
    code: effect.code,
    countLimit: effect.countLimit,
    event: effect.event,
    range: effect.range,
  }))).toEqual([
    { category: categoryCoin, code: undefined, countLimit: 1, event: "ignition", range: ["monsterZone"] },
  ]);
  const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === goddess.uid);
  expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  applyRestored(restored, activation!);
  return { session: restored.session, card: restored.session.state.cards.find((card) => card.uid === goddess.uid)! };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Goddess of Whim");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("e1:SetCountLimit(1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("if Duel.CallCoin(tp) then");
  expect(script).toContain("e1:SetValue(c:GetAttack()*2)");
  expect(script).toContain("e1:SetValue(c:GetAttack()/2)");
}

function expectFinalAttackEffect(session: DuelSession, card: DuelCardInstance, value: number): void {
  expect(session.state.effects.filter((effect) => effect.code === effectSetAttackFinal).map((effect) => ({
    code: effect.code,
    event: effect.event,
    range: effect.range,
    sourceUid: effect.sourceUid,
    value: effect.value,
  }))).toEqual([
    { code: effectSetAttackFinal, event: "continuous", range: ["monsterZone"], sourceUid: card.uid, value },
  ]);
}

function expectCoinEvent(session: DuelSession, card: DuelCardInstance, eventValue: number): void {
  expect(session.state.eventHistory.filter((event) => event.eventName === "coinTossed")).toEqual([
    {
      eventName: "coinTossed",
      eventCode: 1151,
      eventPlayer: 0,
      eventValue,
      eventReason: duelReason.effect,
      eventReasonPlayer: 0,
      eventReasonCardUid: card.uid,
      eventReasonEffectId: 1,
    },
  ]);
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
