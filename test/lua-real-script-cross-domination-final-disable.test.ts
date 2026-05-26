import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const crossCode = "93356623";
const hasCrossScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${crossCode}.lua`));
const musketeerCode = "933566230";
const targetCode = "933566231";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const setMagicalMusket = 0x108;

describe.skipIf(!hasUpstreamScripts || !hasCrossScript)("Lua real script Cross-Domination final disable", () => {
  it("restores Magical Musket target final ATK/DEF zero and related-chain negation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${crossCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE+CATEGORY_DISABLE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_MAGICAL_MUSKET),tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("e0:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e0:SetValue(0)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("Duel.NegateRelatedChain(tc,RESET_TURN_SET)");
    expect(script).toContain("e2:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e3:SetCode(EFFECT_DISABLE_EFFECT)");

    const cards: DuelCardData[] = [
      { code: crossCode, name: "Magical Musket - Cross-Domination", kind: "spell", typeFlags: typeSpell, setcodes: [setMagicalMusket] },
      { code: musketeerCode, name: "Magical Musketeer Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMagicalMusket], level: 4, attack: 1600, defense: 1200 },
      { code: targetCode, name: "Cross-Domination Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2100, defense: 1800 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 93356623, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [crossCode, musketeerCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const cross = requireCard(session, crossCode);
    const musketeer = requireCard(session, musketeerCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, cross.uid, "hand", 0);
    moveDuelCard(session.state, musketeer.uid, "monsterZone", 0).position = "faceUpAttack";
    musketeer.faceUp = true;
    moveDuelCard(session.state, target.uid, "monsterZone", 1).position = "faceUpAttack";
    target.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(crossCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === cross.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, action!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === musketeer.uid), restoredOpen.session.state)).toBe(0);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === musketeer.uid), restoredOpen.session.state)).toBe(0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === musketeer.uid && [102, 106, 10, 12].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 102, controller: 0, event: "continuous", range: ["monsterZone"], sourceUid: musketeer.uid, value: 0 },
      { code: 106, controller: 0, event: "continuous", range: ["monsterZone"], sourceUid: musketeer.uid, value: 0 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: musketeer.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
