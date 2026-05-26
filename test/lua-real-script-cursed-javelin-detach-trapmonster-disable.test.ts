import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const cursedJavelinCode = "12219047";
const materialCode = "122190470";
const trapMonsterTargetCode = "122190471";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrapMonster = 0x100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Phantom Knights Cursed Javelin detach trapmonster disable", () => {
  it("restores detach-cost target disable into final ATK zero and Trap Monster disable", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cursedJavelinCode}.lua`);
    expectScriptShape(script);

    const databaseCards = workspace.readDatabaseCards("cards.cdb");
    const cursedJavelinData = databaseCards.find((card) => card.code === cursedJavelinCode);
    expect(cursedJavelinData).toBeDefined();
    const cards: DuelCardData[] = [
      cursedJavelinData!,
      { code: materialCode, name: "Cursed Javelin Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 800, defense: 800 },
      { code: trapMonsterTargetCode, name: "Cursed Javelin Trap Monster Target", kind: "monster", typeFlags: typeMonster | typeEffect | typeTrapMonster, level: 4, attack: 2300, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 12219047, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode], extra: [cursedJavelinCode] }, 1: { main: [trapMonsterTargetCode] } });
    startDuel(session);

    const cursedJavelin = requireCard(session, cursedJavelinCode);
    const material = requireCard(session, materialCode);
    const target = requireCard(session, trapMonsterTargetCode);
    moveFaceUpAttack(session, cursedJavelin, 0);
    cursedJavelin.summonType = "xyz";
    cursedJavelin.summonPlayer = 0;
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    cursedJavelin.overlayUids.push(material.uid);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cursedJavelinCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === cursedJavelin.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, action!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === cursedJavelin.uid)?.overlayUids).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: cursedJavelin.uid,
      reasonEffectId: 2,
    });
    const restoredTarget = restoredOpen.session.state.cards.find((card) => card.uid === target.uid);
    expect(restoredTarget).toBeDefined();
    expect(currentAttack(restoredTarget!, restoredOpen.session.state)).toBe(0);
    expect(isCardDisabled(restoredOpen.session.state, restoredTarget!, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredOpen.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [2, 8, 10, 102].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 2, event: "continuous", property: 1024, reset: { flags: 1107169792 }, value: undefined },
      { code: 8, event: "continuous", property: 1024, reset: { flags: 1107169792 }, value: 131072 },
      { code: 102, event: "continuous", property: 1024, reset: { flags: 1107169792 }, value: 0 },
      { code: 10, event: "continuous", property: undefined, reset: { flags: 1107169792 }, value: undefined },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial" || event.eventName === "becameTarget")).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: cursedJavelin.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Xyz.AddProcedure(c,nil,2,2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DISABLE)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("return not e:GetHandler():GetOverlayGroup():IsExists(Card.IsSetCard,1,nil,SET_THE_PHANTOM_KNIGHTS)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("return e:GetHandler():GetOverlayGroup():IsExists(Card.IsSetCard,1,nil,SET_THE_PHANTOM_KNIGHTS)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.NegateRelatedChain(tc,RESET_TURN_SET)");
  expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
  expect(script).toContain("e3:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e4:SetCode(EFFECT_DISABLE_TRAPMONSTER)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.position = "faceUpAttack";
  moved.faceUp = true;
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
