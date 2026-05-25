import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
const abareUshioniCode = "89718302";
const hasAbareUshioniScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${abareUshioniCode}.lua`));
const categoryDamage = 0x80000;
const categoryCoin = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasAbareUshioniScript)("Lua real script Abare Ushioni coin damage", () => {
  it("restores tails CallCoin into 1000 self damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${abareUshioniCode}.lua`);
    expectScriptShape(script);
    const card = workspace.readDatabaseCards("cards.cdb").find((candidate) => candidate.code === abareUshioniCode);
    expect(card).toBeDefined();
    const reader = createCardReader([card!]);
    const session = createDuel({ seed: 1, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [abareUshioniCode] }, 1: { main: [] } });
    startDuel(session);

    const abareUshioni = requireCard(session, abareUshioniCode);
    moveFaceUpAttack(session, abareUshioni, 0, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(abareUshioniCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === abareUshioni.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
    }))).toEqual([
      { category: categoryCoin | categoryDamage, code: undefined, countLimit: 1, event: "ignition", range: ["monsterZone"] },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === abareUshioni.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(restoredOpen.session.state.lastCoinResults).toEqual([0]);
    expect(restoredOpen.session.state.players[0].lifePoints).toBe(7000);
    expect(restoredOpen.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["coinTossed", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: abareUshioni.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: abareUshioni.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Abare Ushioni");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN+CATEGORY_DAMAGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("e1:SetCountLimit(1)");
  expect(script).toContain("e1:SetTarget(s.damtg)");
  expect(script).toContain("e1:SetOperation(s.damop)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("if Duel.CallCoin(tp) then");
  expect(script).toContain("Duel.Damage(1-tp,1000,REASON_EFFECT)");
  expect(script).toContain("Duel.Damage(tp,1000,REASON_EFFECT)");
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
