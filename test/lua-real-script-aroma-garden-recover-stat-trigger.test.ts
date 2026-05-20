import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const aromaGardenCode = "5050644";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAromaGardenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${aromaGardenCode}.lua`));
const aromaMonsterCode = "50506440";
const allyMonsterCode = "50506441";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeField = 0x10000;
const setAroma = 0xc9;

describe.skipIf(!hasUpstreamScripts || !hasAromaGardenScript)("Lua real script Aroma Garden recover stat trigger", () => {
  it("restores field ignition recovery stat boost and destroyed Aroma mandatory recovery trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${aromaGardenCode}.lua`);
    expect(script).toContain("e2:SetCategory(CATEGORY_RECOVER+CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
    expect(script).toContain("e2:SetRange(LOCATION_FZONE)");
    expect(script).toContain("Duel.SetTargetPlayer(tp)");
    expect(script).toContain("Duel.SetTargetParam(500)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("Duel.Recover(p,d,REASON_EFFECT)");
    expect(script).toContain("Duel.RegisterEffect(e1,tp)");
    expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("c:IsPreviousLocation(LOCATION_MZONE)");
    expect(script).toContain("c:IsReason(REASON_DESTROY) and c:IsReason(REASON_BATTLE|REASON_EFFECT)");
    expect(script).toContain("Duel.SetTargetParam(1000)");

    const cards: DuelCardData[] = [
      { code: aromaGardenCode, name: "Aroma Garden", kind: "spell", typeFlags: typeSpell | typeField, setcodes: [setAroma] },
      { code: aromaMonsterCode, name: "Aroma Garden Aroma Monster", kind: "monster", typeFlags: typeMonster, setcodes: [setAroma], level: 4, attack: 1500, defense: 1200 },
      { code: allyMonsterCode, name: "Aroma Garden Ally Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5050644, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [aromaGardenCode, aromaMonsterCode, allyMonsterCode] }, 1: { main: [] } });
    startDuel(session);

    const garden = requireCard(session, aromaGardenCode);
    const aroma = requireCard(session, aromaMonsterCode);
    const ally = requireCard(session, allyMonsterCode);
    moveDuelCard(session.state, garden.uid, "spellTrapZone", 0).faceUp = true;
    moveFaceUpAttack(session, aroma, 0);
    moveFaceUpAttack(session, ally, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(aromaGardenCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const ignition = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === garden.uid && action.effectId === "lua-2");
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(ignition).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredOpen, ignition!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.players[0].lifePoints).toBe(8500);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === aroma.uid), restoredOpen.session.state)).toBe(2000);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === aroma.uid), restoredOpen.session.state)).toBe(1700);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === ally.uid), restoredOpen.session.state)).toBe(1500);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === ally.uid), restoredOpen.session.state)).toBe(1500);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "recoveredLifePoints")).toEqual([
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: garden.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === garden.uid && [100, 104].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 100, controller: 0, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], sourceUid: garden.uid, targetRange: [4, 0], value: 500 },
      { code: 104, controller: 0, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], sourceUid: garden.uid, targetRange: [4, 0], value: 500 },
    ]);

    const restoredBoosted = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBoosted);
    destroyDuelCard(restoredBoosted.session.state, aroma.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredBoosted.session.state.pendingTriggers).toMatchObject([
      {
        effectId: "lua-3-1014",
        eventCardUid: aroma.uid,
        eventName: "sentToGraveyard",
        sourceUid: garden.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBoosted.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const recoverTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === garden.uid);
    expect(recoverTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(recoverTrigger).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredTrigger, recoverTrigger!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.players[0].lifePoints).toBe(9500);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "recoveredLifePoints")).toEqual([
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: garden.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 0,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: garden.uid,
        eventReasonEffectId: 3,
      },
    ]);
  });
});

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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
