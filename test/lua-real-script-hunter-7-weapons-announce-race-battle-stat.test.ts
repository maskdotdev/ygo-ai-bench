import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hunterCode = "1525329";
const warriorTargetCode = "15253290";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHunterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${hunterCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const allRaces = [
  0x1, 0x2, 0x4, 0x8, 0x10, 0x20, 0x40, 0x80, 0x100, 0x200, 0x400, 0x800, 0x1000,
  0x2000, 0x4000, 0x8000, 0x10000, 0x20000, 0x40000, 0x80000, 0x100000, 0x200000,
  0x400000, 0x800000, 0x1000000, 0x2000000,
];

describe.skipIf(!hasUpstreamScripts || !hasHunterScript)("Lua real script Hunter with 7 Weapons AnnounceRace battle stat", () => {
  it("restores summon AnnounceRace into race-gated pre-damage ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${hunterCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_EQUIP)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("Duel.AnnounceRace(tp,1,RACE_ALL)");
    expect(script).toContain("e:GetHandler():SetHint(CHINT_RACE,rc)");
    expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("return bc and bc:IsRace(e:GetLabel())");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetReset(RESET_PHASE|PHASE_DAMAGE_CAL)");
    expect(script).toContain("e1:SetValue(1000)");

    const cards: DuelCardData[] = [
      { code: hunterCode, name: "The Hunter with 7 Weapons", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 1000, defense: 600 },
      { code: warriorTargetCode, name: "Hunter Warrior Battle Target", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1700, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1525329, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hunterCode] }, 1: { main: [warriorTargetCode] } });
    startDuel(session);

    const hunter = session.state.cards.find((card) => card.code === hunterCode);
    const warriorTarget = session.state.cards.find((card) => card.code === warriorTargetCode);
    expect(hunter).toBeDefined();
    expect(warriorTarget).toBeDefined();
    moveDuelCard(session.state, hunter!.uid, "hand", 0);
    moveFaceUpAttack(session, warriorTarget!.uid, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const promptOverrides = [{ api: "AnnounceRace" as const, player: 0 as PlayerId, returned: raceWarrior }];
    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    expect(host.loadCardScript(Number(hunterCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === hunter!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummon, summon!);

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredSummonTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === hunter!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummonTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummonTrigger, trigger!);
    expect(restoredSummonTrigger.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "AnnounceRace", player: 0, options: allRaces, descriptions: allRaces, returned: raceWarrior },
    ]);
    expect(restoredSummonTrigger.session.state.chain).toEqual([]);
    expect(restoredSummonTrigger.session.state.effects.filter((effect) => effect.sourceUid === hunter!.uid && effect.code === 1134).map((effect) => ({
      code: effect.code,
      event: effect.event,
      label: effect.label,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { code: 1134, event: "trigger", label: raceWarrior, triggerEvent: "beforeDamageCalculation" },
    ]);

    restoredSummonTrigger.session.state.phase = "battle";
    restoredSummonTrigger.session.state.waitingFor = 0;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredSummonTrigger.session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === hunter!.uid && action.targetUid === warriorTarget!.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    passUntilPendingTrigger(restoredBattle.session);
    expect(restoredBattle.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredPreDamage);
    expectRestoredLegalActions(restoredPreDamage, 0);
    const preDamage = getLuaRestoreLegalActions(restoredPreDamage, 0).find((action) => action.type === "activateTrigger" && action.uid === hunter!.uid);
    expect(preDamage, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPreDamage, preDamage!);
    expect(currentAttack(restoredPreDamage.session.state.cards.find((card) => card.uid === hunter!.uid), restoredPreDamage.session.state)).toBe(2000);
    expect(restoredPreDamage.session.state.effects.filter((effect) => effect.sourceUid === hunter!.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 1073741888 }, value: 1000 },
    ]);
    expect(restoredPreDamage.session.state.eventHistory.filter((event) => event.eventName === "beforeDamageCalculation")).toEqual([
      {
        eventName: "beforeDamageCalculation",
        eventCode: 1134,
        eventCardUid: hunter!.uid,
        eventUids: [hunter!.uid, warriorTarget!.uid],
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function moveFaceUpAttack(session: DuelSession, uid: string, player: PlayerId): void {
  const moved = moveDuelCard(session.state, uid, "monsterZone", player);
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
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function passUntilPendingTrigger(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    const response = applyResponse(session, pass!);
    expect(response.ok, response.error).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
