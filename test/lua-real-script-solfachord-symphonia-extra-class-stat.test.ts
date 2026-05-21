import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const symphoniaCode = "56510115";
const targetCode = "565101150";
const nonPendulumDecoyCode = "565101151";
const extraOneCode = "565101152";
const extraTwoCode = "565101153";
const extraThreeCode = "565101154";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typePendulum = 0x1000000;
const setSolfachord = 0x164;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Solfachord Symphonia extra class stat", () => {
  it("restores three distinct face-up Extra Deck Solfachords into field Pendulum ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${symphoniaCode}.lua`);
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("Duel.GetMatchingGroup(s.solfilter,tp,LOCATION_EXTRA,0,nil):GetClassCount(Card.GetCode)>2");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_EXTRA)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetTargetRange(LOCATION_MZONE,0)");
    expect(script).toContain("e1:SetValue(function(e,c) return c:GetScale()*300 end)");
    expect(script).toContain("Duel.RegisterEffect(e1,tp)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === symphoniaCode),
      solfachordPendulum(targetCode, "Symphonia Solfachord Target", 3, 1000),
      { code: nonPendulumDecoyCode, name: "Symphonia Non-Pendulum Solfachord Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000, setcodes: [setSolfachord] },
      solfachordPendulum(extraOneCode, "Symphonia Extra Solfachord One", 1, 800),
      solfachordPendulum(extraTwoCode, "Symphonia Extra Solfachord Two", 3, 900),
      solfachordPendulum(extraThreeCode, "Symphonia Extra Solfachord Three", 5, 1000),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 56510115, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [symphoniaCode, targetCode, nonPendulumDecoyCode], extra: [extraOneCode, extraTwoCode, extraThreeCode] }, 1: { main: [] } });
    startDuel(session);

    const symphonia = requireCard(session, symphoniaCode);
    const target = requireCard(session, targetCode);
    const nonPendulumDecoy = requireCard(session, nonPendulumDecoyCode);
    moveDuelCard(session.state, symphonia.uid, "hand", 0);
    moveFaceUpAttack(session, target, 0);
    moveFaceUpAttack(session, nonPendulumDecoy, 0);
    for (const code of [extraOneCode, extraTwoCode, extraThreeCode]) {
      const extra = requireCard(session, code);
      extra.faceUp = true;
    }
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(symphoniaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === symphonia.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toHaveLength(0);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === target.uid), restoredResolved.session.state)).toBe(1900);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === nonPendulumDecoy.uid), restoredResolved.session.state)).toBe(1600);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === symphonia.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      luaValueDescriptor: effect.luaValueDescriptor,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      {
        code: 100,
        luaTargetDescriptor: "target:setcode-type:356:16777216",
        luaValueDescriptor: "stat:current-scale:x300",
        reset: { flags: 1073742336 },
        value: undefined,
      },
    ]);
    expect(restoredResolved.session.state.eventHistory.filter((event) => ["destroyed", "cardsDrawn", "specialSummoned"].includes(event.eventName))).toEqual([]);
    expect(restoredResolved.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo")).toEqual([]);
  });
});

function solfachordPendulum(code: string, name: string, scale: number, attack: number): DuelCardData {
  return {
    code,
    name,
    kind: "monster",
    typeFlags: typeMonster | typePendulum | typeEffect,
    level: 4,
    attack,
    defense: 1000,
    leftScale: scale,
    rightScale: scale,
    setcodes: [setSolfachord],
  };
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
