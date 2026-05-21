import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cardTypeFlags, currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const divineEvolutionCode = "7373632";
const hasDivineEvolutionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${divineEvolutionCode}.lua`));
const raCode = "21208154";
const opponentMonsterCode = "73736320";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;
const effectCannotInactivate = 12;
const effectCannotDiseffect = 13;
const effectAddType = 115;

describe.skipIf(!hasUpstreamScripts || !hasDivineEvolutionScript)("Lua real script Divine Evolution grant attack send", () => {
  it("restores unnegatable Divine Evolution stat/type/flag grant into attack-announce opponent send", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${divineEvolutionCode}.lua`);
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_CANNOT_NEGATE+EFFECT_FLAG_CANNOT_INACTIVATE)");
    expect(script).toContain("return c:IsFaceup() and (c:IsOriginalRace(RACE_DIVINE) or c:IsOriginalCodeRule(21208154,62180201,57793869))");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil):GetFirst()");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CLIENT_HINT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e3:SetCode(EFFECT_CANNOT_INACTIVATE)");
    expect(script).toContain("e4:SetCode(EFFECT_CANNOT_DISEFFECT)");
    expect(script).toContain("e5:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("e6:SetCode(EFFECT_ADD_TYPE)");
    expect(script).toContain("tc:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD,0,1)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,1-tp,LOCATION_MZONE)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_RULE,PLAYER_NONE,1-tp)");

    const cards: DuelCardData[] = [
      { code: divineEvolutionCode, name: "Divine Evolution", kind: "spell", typeFlags: typeSpell },
      { code: raCode, name: "The Winged Dragon of Ra", kind: "monster", typeFlags: typeMonster, level: 10, attack: 0, defense: 0 },
      { code: opponentMonsterCode, name: "Divine Evolution Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1400, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7373632, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [divineEvolutionCode, raCode] }, 1: { main: [opponentMonsterCode] } });
    startDuel(session);

    const divineEvolution = requireCard(session, divineEvolutionCode);
    const ra = requireCard(session, raCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    moveDuelCard(session.state, divineEvolution.uid, "hand", 0);
    moveFaceUpAttack(session, ra, 0);
    moveFaceUpAttack(session, opponentMonster, 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(divineEvolutionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === divineEvolution.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);

    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.session.state.chain).toEqual([]);
    const restoredRa = restoredOpen.session.state.cards.find((card) => card.uid === ra.uid);
    expect(restoredRa).toBeDefined();
    expect(currentAttack(restoredRa, restoredOpen.session.state)).toBe(1000);
    expect(currentDefense(restoredRa, restoredOpen.session.state)).toBe(1000);
    expect(cardTypeFlags(restoredRa!, restoredOpen.session.state) & typeEffect).toBe(typeEffect);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === divineEvolution.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === ra.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", range: ["monsterZone"], reset: { flags: 33427456 }, sourceUid: ra.uid, value: 1000 },
      { code: effectUpdateDefense, event: "continuous", range: ["monsterZone"], reset: { flags: 33427456 }, sourceUid: ra.uid, value: 1000 },
      { code: effectCannotInactivate, event: "continuous", range: ["monsterZone"], reset: { flags: 33427456 }, sourceUid: ra.uid, value: undefined },
      { code: effectCannotDiseffect, event: "continuous", range: ["monsterZone"], reset: { flags: 33427456 }, sourceUid: ra.uid, value: undefined },
      {
        code: 1130,
        event: "trigger",
        range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"],
        reset: { flags: 33427456 },
        sourceUid: ra.uid,
        value: undefined,
      },
      { code: effectAddType, event: "continuous", range: ["monsterZone"], reset: { flags: 33427456 }, sourceUid: ra.uid, value: typeEffect },
    ]);
    expect(restoredOpen.session.state.flagEffects.filter((flag) => flag.ownerType === "card" && flag.ownerId === ra.uid && flag.code === Number(divineEvolutionCode)).map((flag) => ({
      ownerType: flag.ownerType,
      ownerId: flag.ownerId,
      code: flag.code,
      reset: flag.reset,
      value: flag.value,
    }))).toEqual([
      { ownerType: "card", ownerId: ra.uid, code: Number(divineEvolutionCode), reset: 33427456, value: 0 },
    ]);

    restoredOpen.session.state.phase = "battle";
    restoredOpen.session.state.waitingFor = 0;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === ra.uid && action.targetUid === opponentMonster.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      sourceUid: trigger.sourceUid,
      player: trigger.player,
      triggerBucket: trigger.triggerBucket,
      eventName: trigger.eventName,
      eventCardUid: trigger.eventCardUid,
    }))).toEqual([
      {
        sourceUid: ra.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "attackDeclared",
        eventCardUid: ra.uid,
      },
    ]);

    const restoredAttack = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const sendTrigger = getLuaRestoreLegalActions(restoredAttack, 0).find((action) => action.type === "activateTrigger" && action.uid === ra.uid);
    expect(sendTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredAttack, sendTrigger!);
    expect(restoredAttack.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredAttack.session.state.cards.find((card) => card.uid === opponentMonster.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 1,
      reasonCardUid: ra.uid,
    });
    expect(restoredAttack.session.state.eventHistory.filter((event) => event.eventName === "moved" && event.eventCardUid === opponentMonster.uid).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
    }))).toEqual([
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: opponentMonster.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 1,
        eventReasonCardUid: ra.uid,
      },
    ]);
  });
});

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = result.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
}
