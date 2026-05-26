import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { duelActivity } from "#duel/activity.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const talentCode = "25311006";
const opponentMonsterCode = "253110060";
const opponentHandCode = "253110061";
const playerDrawCodeA = "253110062";
const playerDrawCodeB = "253110063";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTalentScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${talentCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryToDeck = 0x10;
const promptOverrides = [{ api: "SelectEffect" as const, player: 0 as const, returned: 3 }];

describe.skipIf(!hasUpstreamScripts || !hasTalentScript)("Lua real script Triple Tactics Talent SelectEffect branch", () => {
  it("restores opponent monster-effect activity into to-Deck hand branch selection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${talentCode}.lua`);
    expect(script).toContain("--Triple Tactics Talent");
    expect(script).toContain("Duel.AddCustomActivityCounter(id,ACTIVITY_CHAIN,function(re,tp,cid) return not (Duel.IsMainPhase() and re:IsMonsterEffect()) end)");
    expect(script).toContain("Duel.GetCustomActivityCount(id,1-tp,ACTIVITY_CHAIN)>0");
    expect(script).toContain("local op=Duel.SelectEffect(tp,");
    expect(script).toContain("e:SetCategory(CATEGORY_DRAW)");
    expect(script).toContain("e:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e:SetCategory(CATEGORY_TODECK)");
    expect(script).toContain("Duel.GetControl(g,tp,PHASE_END,1)");
    expect(script).toContain("Duel.ConfirmCards(p,g)");
    expect(script).toContain("Duel.SendtoDeck(sg,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
    expect(script).toContain("Duel.ShuffleHand(1-p)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 25311006, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [talentCode, playerDrawCodeA, playerDrawCodeB] },
      1: { main: [opponentMonsterCode, opponentHandCode] },
    });
    startDuel(session);

    const talent = requireCard(session, talentCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    const opponentHand = requireCard(session, opponentHandCode);
    moveDuelCard(session.state, talent.uid, "hand", 0);
    moveDuelCard(session.state, playerDrawCodeAUid(session), "deck", 0).sequence = 0;
    moveDuelCard(session.state, playerDrawCodeBUid(session), "deck", 0).sequence = 1;
    moveFaceUpAttack(session, opponentMonster, 1, 0);
    moveDuelCard(session.state, opponentHand.uid, "hand", 1);
    session.state.activityHistory.push({ player: 1, activity: duelActivity.chain, cardUid: opponentMonster.uid });
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    expect(host.loadCardScript(Number(talentCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === talent.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      countLimitCode: effect.countLimitCode,
      event: effect.event,
      property: effect.property,
    }))).toEqual([
      { category: undefined, code: 1002, countLimit: 1, countLimitCode: Number(talentCode), event: "ignition", property: undefined },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === talent.uid
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredOpen, activation!);
    expect(restoredOpen.host.promptDecisions.flatMap((prompt) => {
      if (prompt.api !== "SelectEffect" || !("options" in prompt)) return [];
      return [{
        api: prompt.api,
        options: prompt.options,
        player: prompt.player,
        returned: prompt.returned,
      }];
    })).toEqual([{ api: "SelectEffect", options: [1, 2, 3], player: 0, returned: 3 }]);
    if (restoredOpen.session.state.chain.length > 0) {
      expect(restoredOpen.session.state.chain.map((link) => ({
        activationLocation: link.activationLocation,
        effectId: link.effectId,
        operationInfos: link.operationInfos,
        player: link.player,
        sourceUid: link.sourceUid,
        targetPlayer: link.targetPlayer,
      }))).toEqual([
        {
          activationLocation: "hand",
          effectId: "lua-1-1002",
          operationInfos: [{ category: categoryToDeck, targetUids: [], count: 0, player: 1, parameter: 0x10 }],
          player: 0,
          sourceUid: talent.uid,
          targetPlayer: 0,
        },
      ]);
      passRestoredChain(restoredOpen);
    }

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, restoredResolved.session.state.waitingFor ?? restoredResolved.session.state.turnPlayer);
    expect(findCard(restoredResolved.session, opponentHand.uid)).toMatchObject({
      controller: 1,
      location: "deck",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: talent.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restoredResolved.session, opponentMonster.uid)).toMatchObject({ controller: 1, location: "monsterZone" });
    expect(findCard(restoredResolved.session, talent.uid)).toMatchObject({ controller: 0, location: "graveyard" });
    expect(restoredResolved.session.state.eventHistory.filter((event) => ["confirmed", "moved", "sentToDeck"].includes(event.eventName) && event.eventCardUid === opponentHand.uid).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "confirmed", eventCode: 1211, eventCardUid: opponentHand.uid, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "deck", currentLocation: "hand" },
      { eventName: "moved", eventCode: 1030, eventCardUid: opponentHand.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: talent.uid, eventReasonEffectId: 1, previousLocation: "hand", currentLocation: "deck" },
      { eventName: "sentToDeck", eventCode: 1013, eventCardUid: opponentHand.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: talent.uid, eventReasonEffectId: 1, previousLocation: "hand", currentLocation: "deck" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: talentCode, name: "Triple Tactics Talent", kind: "spell", typeFlags: 0x2 },
    { code: opponentMonsterCode, name: "Triple Tactics Opponent Monster Effect", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
    { code: opponentHandCode, name: "Triple Tactics Opponent Hand Card", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
    { code: playerDrawCodeA, name: "Triple Tactics Player Draw A", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: playerDrawCodeB, name: "Triple Tactics Player Draw B", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function playerDrawCodeAUid(session: DuelSession): string {
  return requireCard(session, playerDrawCodeA).uid;
}

function playerDrawCodeBUid(session: DuelSession): string {
  return requireCard(session, playerDrawCodeB).uid;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredAction(restored, pass!);
  }
}
