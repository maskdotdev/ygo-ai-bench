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
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const sunshineCode = "28903523";
const fairyCode = "25862681";
const targetCode = "289035230";
const hasSunshineScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sunshineCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSunshineScript)("Lua real script Eternal Sunshine flag final disable", () => {
  it("restores Ancient Fairy count-gated target final stat halve and effect negation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${sunshineCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("Duel.GetMatchingGroupCount(s.afdfilter,e:GetHandlerPlayer(),LOCATION_ONFIELD,0,nil)*500");
    expect(script).toContain("c:IsCode(CARD_ANCIENT_FAIRY_DRAGON)");
    expect(script).toContain("c:ListsCode(CARD_ANCIENT_FAIRY_DRAGON) and c:IsMonster()");
    expect(script).toContain("Duel.GetFlagEffect(tp,id)<Duel.GetMatchingGroupCount(s.afdfilter,tp,LOCATION_ONFIELD,0,nil)");
    expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,0,1)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,g,1,tp,0)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(math.ceil(tc:GetAttack()/2))");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e2:SetValue(math.ceil(tc:GetDefense()/2))");
    expect(script).toContain("tc:NegateEffects(c,RESETS_STANDARD_PHASE_END)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sunshineCode || card.code === fairyCode),
      { code: targetCode, name: "Eternal Sunshine Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1901, defense: 1701 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 28903523, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sunshineCode, fairyCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const sunshine = requireCard(session, sunshineCode);
    const fairy = requireCard(session, fairyCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, sunshine.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, fairy.uid, "monsterZone", 0).position = "faceUpAttack";
    fairy.faceUp = true;
    moveDuelCard(session.state, target.uid, "monsterZone", 1).position = "faceUpAttack";
    target.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sunshineCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === fairy.uid), restoredOpen.session.state)).toBe(3500);
    const quick = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === sunshine.uid);
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, quick!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.flagEffects).toEqual([
      expect.objectContaining({ code: Number(sunshineCode), ownerId: "0", ownerType: "player", value: 0 }),
    ]);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(951);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(851);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 3,
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
