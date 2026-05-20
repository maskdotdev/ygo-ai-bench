import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const cassimolarCode = "12527118";
const hasCassimolarScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cassimolarCode}.lua`));
const targetCode = "125271180";
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasCassimolarScript)("Lua real script Cassimolar summon delayed stat", () => {
  it("restores summon targeting into ATK gain and next-turn delayed destroy registration", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cassimolarCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DESTROY+CATEGORY_DAMAGE)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("tc:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,EFFECT_FLAG_CLIENT_HINT,2,0,aux.Stringid(id,2))");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)");
    expect(script).toContain("e2:SetLabel(Duel.GetTurnCount())");
    expect(script).toContain("return e:GetLabelObject():GetFlagEffect(id)>0 and Duel.GetTurnCount()~=e:GetLabel()");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
    expect(script).toContain("Duel.Release(c,REASON_COST)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)");

    const cards: DuelCardData[] = [
      { code: cassimolarCode, name: "Cassimolar", kind: "monster", typeFlags: typeMonster, level: 3, attack: 1000, defense: 1000 },
      { code: targetCode, name: "Cassimolar Opponent Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 12527118, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cassimolarCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const cassimolar = requireCard(session, cassimolarCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, cassimolar.uid, "hand", 0);
    moveDuelCard(session.state, target.uid, "monsterZone", 1).position = "faceUpAttack";
    target.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cassimolarCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const summon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === cassimolar.uid);
    expect(summon, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, summon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === cassimolar.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos)).toEqual([]);

    const restoredTarget = restoredTrigger.session.state.cards.find((card) => card.uid === target.uid);
    expect(restoredTarget).toBeDefined();
    expect(currentAttack(restoredTarget, restoredTrigger.session.state)).toBe(4000);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === 100)).toHaveLength(1);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos)).toEqual([]);
    expect(restoredTrigger.session.state.flagEffects).toEqual([
      expect.objectContaining({ ownerType: "card", ownerId: target.uid, code: Number(cassimolarCode), value: 0 }),
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned").map((event) => event.eventCardUid)).toEqual([cassimolar.uid]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const raw = getLuaRestoreLegalActions(restored, player);
  const grouped = getLuaRestoreLegalActionGroups(restored, player);
  expect(grouped.flatMap((group) => group.actions)).toEqual(raw);
  expect(result.legalActions).toEqual(raw);
  expect(result.legalActionGroups).toEqual(grouped);
}
