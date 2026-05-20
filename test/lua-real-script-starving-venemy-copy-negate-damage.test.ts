import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const venemyCode = "93729065";

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Starving Venemy copy negate damage", () => {
  it("restores target copy, ATK/DEF loss, negation, and damage after CopyEffect succeeds", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${venemyCode}.lua`);
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsNegatableMonster,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,g,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,500)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_CODE)");
    expect(script).toContain("if c:CopyEffect(code,RESETS_STANDARD_PHASE_END,1)>0 then");
    expect(script).toContain("tc:UpdateAttack(-500,RESET_EVENT|RESETS_STANDARD,c)");
    expect(script).toContain("tc:UpdateDefense(-500,RESET_EVENT|RESETS_STANDARD,c)");
    expect(script).toContain("tc:NegateEffects(c)");
    expect(script).toContain("Duel.Damage(1-tp,500,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === venemyCode),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 93729065, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [venemyCode] }, 1: { main: [venemyCode] } });
    startDuel(session);

    const venemy = requireCard(session, venemyCode);
    const target = requireCards(session, venemyCode).find((card) => card.owner === 1)!;
    expect(target).toBeDefined();
    moveFaceUpAttack(session, venemy, 0);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(venemyCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(host.messages).not.toContain("unsupported");

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const copyAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === venemy.uid);
    expect(copyAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, copyAction!);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    const restoredVenemy = restoredOpen.session.state.cards.find((card) => card.uid === venemy.uid)!;
    const restoredTarget = restoredOpen.session.state.cards.find((card) => card.uid === target.uid)!;
    expect(currentAttack(restoredTarget, restoredOpen.session.state)).toBe((target.data.attack ?? 0) - 500);
    expect(currentDefense(restoredTarget, restoredOpen.session.state)).toBe((target.data.defense ?? 0) - 500);
    expect(restoredOpen.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredOpen.host.messages).not.toContain("unsupported");
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === venemy.uid && effect.code === 114)).toEqual([
      expect.objectContaining({ code: 114, value: Number(venemyCode), reset: { flags: 1107169792 } }),
    ]);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === restoredVenemy.uid && effect.copyId !== undefined).length).toBeGreaterThan(0);
    expect(restoredOpen.session.state.effects.some((effect) => effect.sourceUid === restoredTarget.uid && effect.code === 2)).toBe(true);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: venemy.uid,
        eventReasonEffectId: 6,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function requireCards(session: DuelSession, code: string): DuelCardInstance[] {
  const cards = session.state.cards.filter((candidate) => candidate.code === code);
  expect(cards.length).toBeGreaterThan(0);
  return cards;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player).position = "faceUpAttack";
  card.faceUp = true;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
