import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const yamorimoriCode = "51474037";
const selfReptileCode = "514740370";
const opponentTargetCode = "514740371";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasYamorimoriScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${yamorimoriCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceReptile = 0x80000;

describe.skipIf(!hasUpstreamScripts || !hasYamorimoriScript)("Lua real script Yamorimori self-banish SelectEffect stat", () => {
  it("restores SelectUnselectGroup targets and SelectEffect destroy branch into opponent final ATK zero", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${yamorimoriCode}.lua`);
    expect(script).toContain("e1:SetRange(LOCATION_GRAVE)");
    expect(script).toContain("e1:SetCost(Cost.SelfBanish)");
    expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,2,2,s.rescon,0)");
    expect(script).toContain("Duel.SetTargetCard(tg)");
    expect(script).toContain("local op=Duel.SelectEffect(tp,");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,self_g,1,tp,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,opp_g,1,tp,0)");
    expect(script).toContain("local g=Duel.GetTargetCards(e)");
    expect(script).toContain("Duel.Destroy(self_c,REASON_EFFECT)>0");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(0)");

    const cards: DuelCardData[] = [
      { code: yamorimoriCode, name: "Yamorimori", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, level: 2, attack: 0, defense: 0 },
      { code: selfReptileCode, name: "Yamorimori Own Reptile", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, level: 4, attack: 1400, defense: 1000 },
      { code: opponentTargetCode, name: "Yamorimori Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2300, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 51474037, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [yamorimoriCode, selfReptileCode] }, 1: { main: [opponentTargetCode] } });
    startDuel(session);

    const yamorimori = requireCard(session, yamorimoriCode);
    const selfReptile = requireCard(session, selfReptileCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    moveDuelCard(session.state, yamorimori.uid, "graveyard", 0);
    yamorimori.faceUp = true;
    moveFaceUpAttack(session, selfReptile, 0);
    moveFaceUpAttack(session, opponentTarget, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace, { promptOverrides: [{ api: "SelectEffect", player: 0, returned: 2 }] });
    expect(host.loadCardScript(Number(yamorimoriCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === yamorimori.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    const activationResponse = applyResponse(session, activation!);
    expect(activationResponse.ok, activationResponse.error).toBe(true);
    const restoredDestroyBranch = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredDestroyBranch);
    expectRestoredLegalActions(restoredDestroyBranch, 1);
    resolveRestoredChain(restoredDestroyBranch);

    expect(host.promptDecisions).toContainEqual({
      id: "lua-prompt-1",
      api: "SelectEffect",
      player: 0,
      options: [1, 2],
      descriptions: [823584593, 823584594],
      returned: 2,
    });
    expect(restoredDestroyBranch.session.state.cards.find((card) => card.uid === yamorimori.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: yamorimori.uid,
      reasonEffectId: 1,
    });
    expect(restoredDestroyBranch.session.state.cards.find((card) => card.uid === selfReptile.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: yamorimori.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredDestroyBranch.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredDestroyBranch.session.state)).toBe(0);
    expect(restoredDestroyBranch.session.state.effects.filter((effect) => effect.sourceUid === opponentTarget.uid && effect.code === 102).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 102, reset: { flags: 1107169792 }, sourceUid: opponentTarget.uid, value: 0 },
    ]);
    expect(restoredDestroyBranch.session.state.eventHistory.filter((event) => ["banished", "becameTarget", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: yamorimori.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: yamorimori.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: selfReptile.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: opponentTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: selfReptile.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: yamorimori.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredDestroyBranch.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
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
    applyRestoredActionAndAssert(restored, pass!);
  }
}
