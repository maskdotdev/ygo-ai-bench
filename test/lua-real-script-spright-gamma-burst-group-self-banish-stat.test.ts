import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const gammaCode = "42431833";
const allyCode = "424318330";
const opponentCode = "424318331";
const decoyCode = "424318332";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGammaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gammaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeQuickplay = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasGammaScript)("Lua real script Spright Gamma Burst group and self-banish stat", () => {
  it("restores group Level/Rank/Link 2 stat boost and grave self-banish target ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gammaCode}.lua`);
    expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("return c:IsFaceup() and (c:IsLevel(2) or c:IsRank(2) or c:IsLink(2))");
    expect(script).toContain("local tg=Duel.GetMatchingGroup(s.atkfilter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
    expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");

    const cards: DuelCardData[] = [
      { code: gammaCode, name: "Spright Gamma Burst", kind: "spell", typeFlags: typeSpell | typeQuickplay },
      { code: allyCode, name: "Gamma Burst Level 2 Ally", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 1000, defense: 800 },
      { code: opponentCode, name: "Gamma Burst Level 2 Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 1200, defense: 1000 },
      { code: decoyCode, name: "Gamma Burst Level 4 Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1600 },
    ];
    const reader = createCardReader(cards);

    const restoredGroup = createRestoredGammaField({ reader, workspace, gammaLocation: "hand" });
    expectCleanRestore(restoredGroup);
    expectRestoredLegalActions(restoredGroup, 0);
    const handGamma = requireCard(restoredGroup.session, gammaCode);
    const groupAction = getLuaRestoreLegalActions(restoredGroup, 0).find((action) => action.type === "activateEffect" && action.uid === handGamma.uid);
    expect(groupAction, JSON.stringify(getLuaRestoreLegalActions(restoredGroup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredGroup, groupAction!);
    const ally = requireCard(restoredGroup.session, allyCode);
    const opponent = requireCard(restoredGroup.session, opponentCode);
    const decoy = requireCard(restoredGroup.session, decoyCode);
    expect(currentAttack(ally, restoredGroup.session.state)).toBe(2400);
    expect(currentDefense(ally, restoredGroup.session.state)).toBe(2200);
    expect(currentAttack(opponent, restoredGroup.session.state)).toBe(2600);
    expect(currentDefense(opponent, restoredGroup.session.state)).toBe(2400);
    expect(currentAttack(decoy, restoredGroup.session.state)).toBe(1800);
    expect(restoredGroup.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredGroup.session.state.effects.filter((effect) => effect.sourceUid === ally.uid && [100, 104].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 1107169792 }, value: 1400 },
      { code: 104, reset: { flags: 1107169792 }, value: 1400 },
    ]);

    const restoredSelfBanish = createRestoredGammaField({ reader, workspace, gammaLocation: "graveyard" });
    expectCleanRestore(restoredSelfBanish);
    expectRestoredLegalActions(restoredSelfBanish, 0);
    const graveGamma = requireCard(restoredSelfBanish.session, gammaCode);
    const graveAlly = requireCard(restoredSelfBanish.session, allyCode);
    const selfBanishAction = getLuaRestoreLegalActions(restoredSelfBanish, 0).find((action) => action.type === "activateEffect" && action.uid === graveGamma.uid);
    expect(selfBanishAction, JSON.stringify(getLuaRestoreLegalActions(restoredSelfBanish, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSelfBanish, selfBanishAction!);
    expect(restoredSelfBanish.session.state.cards.find((card) => card.uid === graveGamma.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveGamma.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(graveAlly, restoredSelfBanish.session.state)).toBe(2400);
    expect(currentDefense(graveAlly, restoredSelfBanish.session.state)).toBe(800);
    expect(restoredSelfBanish.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredSelfBanish.session.state.eventHistory.filter((event) => event.eventName === "banished" || event.eventName === "becameTarget")).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: graveGamma.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: graveGamma.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: graveAlly.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);
  });
});

function createRestoredGammaField({
  reader,
  workspace,
  gammaLocation,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  gammaLocation: "hand" | "graveyard";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: gammaLocation === "hand" ? 42431833 : 42431834, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [gammaCode, allyCode, decoyCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, gammaCode).uid, gammaLocation, 0).faceUp = gammaLocation === "graveyard";
  moveFaceUpAttack(session, requireCard(session, allyCode), 0);
  moveFaceUpAttack(session, requireCard(session, decoyCode), 0);
  moveFaceUpAttack(session, requireCard(session, opponentCode), 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(gammaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: ReturnType<typeof requireCard>, player: PlayerId): void {
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
