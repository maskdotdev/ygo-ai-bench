import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setAquaactress = 0x10cd;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Aqua Story Urashima disable immunity", () => {
  it("restores Aqua Story target disable, final 100 ATK/DEF, related-chain negation, and opponent-effect immunity", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const urashimaCode = "28325165";
    const graveAquaactressCode = "283251650";
    const targetCode = "283251651";
    const script = workspace.readScript(`c${urashimaCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DISABLE+CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("return aux.StatChangeDamageStepCondition() and Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_GRAVE,0,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,g,1,0,0)");
    expect(script).toContain("Duel.NegateRelatedChain(tc,RESET_TURN_SET)");
    expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
    expect(script).toContain("e3:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e3:SetValue(100)");
    expect(script).toContain("e4:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e5:SetProperty(EFFECT_FLAG_SINGLE_RANGE+EFFECT_FLAG_CLIENT_HINT)");
    expect(script).toContain("e5:SetCode(EFFECT_IMMUNE_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === urashimaCode),
      { code: graveAquaactressCode, name: "Aqua Story Grave Aquaactress", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setAquaactress], level: 4, attack: 1000, defense: 1000 },
      { code: targetCode, name: "Aqua Story Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2400, defense: 2000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 28325165, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [urashimaCode, graveAquaactressCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const urashima = requireCard(session, urashimaCode);
    const graveAquaactress = requireCard(session, graveAquaactressCode);
    const target = requireCard(session, targetCode);
    const setUrashima = moveDuelCard(session.state, urashima.uid, "spellTrapZone", 0);
    setUrashima.faceUp = false;
    setUrashima.position = "faceDown";
    moveDuelCard(session.state, graveAquaactress.uid, "graveyard", 0);
    moveDuelCard(session.state, target.uid, "monsterZone", 1).position = "faceUpAttack";
    target.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(urashimaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === urashima.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(action).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restored, action!);

    expect(restored.session.state.chain).toEqual([]);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === target.uid), restored.session.state)).toBe(100);
    expect(currentDefense(restored.session.state.cards.find((card) => card.uid === target.uid), restored.session.state)).toBe(100);
    expect(restored.session.state.cards.find((card) => card.uid === urashima.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [1, 8, 10, 102, 106].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 8, controller: 1, event: "continuous", range: ["monsterZone"], sourceUid: target.uid, value: 131072 },
      { code: 102, controller: 1, event: "continuous", range: ["monsterZone"], sourceUid: target.uid, value: 100 },
      { code: 106, controller: 1, event: "continuous", range: ["monsterZone"], sourceUid: target.uid, value: 100 },
      { code: 1, controller: 1, event: "continuous", range: ["monsterZone"], sourceUid: target.uid, value: undefined },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
