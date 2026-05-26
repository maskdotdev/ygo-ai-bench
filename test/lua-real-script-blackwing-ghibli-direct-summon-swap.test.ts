import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentBaseAttack, currentBaseDefense, currentDefense } from "#duel/card-stats.js";
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
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const ghibliCode = "26775203";
const attackerCode = "267752030";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Blackwing Ghibli direct summon swap", () => {
  it("restores direct-attack hand Special Summon and ignition base ATK/DEF swap", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ghibliCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
    expect(script).toContain("local at=Duel.GetAttacker()");
    expect(script).toContain("return at:GetControler()~=tp and Duel.GetAttackTarget()==nil");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,0,0)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetCode(EFFECT_SWAP_BASE_AD)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ghibliCode),
      { code: attackerCode, name: "Ghibli Fixture Direct Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 26775203, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ghibliCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const ghibli = requireCard(session, ghibliCode);
    const attacker = requireCard(session, attackerCode);
    moveDuelCard(session.state, ghibli.uid, "hand", 0);
    moveDuelCard(session.state, attacker.uid, "monsterZone", 1);
    attacker.faceUp = true;
    attacker.position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ghibliCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.directAttack,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1130",
        eventCardUid: attacker.uid,
        eventCode: 1130,
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "attackDeclared",
        eventPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: ghibli.uid,
        triggerBucket: "opponentOptional",
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === ghibli.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    const restoredSummonChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredSummonChain);
    expectRestoredLegalActions(restoredSummonChain, restoredSummonChain.session.state.waitingFor ?? restoredSummonChain.session.state.turnPlayer);
    expect(restoredSummonChain.session.state.cards.find((card) => card.uid === ghibli.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: ghibli.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummonChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: ghibli.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: ghibli.uid,
        eventReasonEffectId: 1,
        eventUids: [ghibli.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    restoredSummonChain.session.state.phase = "main1";
    restoredSummonChain.session.state.turnPlayer = 0;
    restoredSummonChain.session.state.waitingFor = 0;
    delete restoredSummonChain.session.state.pendingBattle;
    delete restoredSummonChain.session.state.currentAttack;
    delete restoredSummonChain.session.state.battleStep;
    delete restoredSummonChain.session.state.battleWindow;
    const restoredSwap = restoreDuelWithLuaScripts(serializeDuel(restoredSummonChain.session), workspace, reader);
    expectCleanRestore(restoredSwap);
    expectRestoredLegalActions(restoredSwap, 0);
    const swap = getLuaRestoreLegalActions(restoredSwap, 0).find((action) => action.type === "activateEffect" && action.uid === ghibli.uid);
    expect(swap, JSON.stringify(getLuaRestoreLegalActions(restoredSwap, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSwap, swap!);
    expect(restoredSwap.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    const restoredSwapChain = restoreDuelWithLuaScripts(serializeDuel(restoredSwap.session), workspace, reader);
    expectCleanRestore(restoredSwapChain);
    expectRestoredLegalActions(restoredSwapChain, restoredSwapChain.session.state.waitingFor ?? restoredSwapChain.session.state.turnPlayer);
    expect(restoredSwapChain.session.state.effects.filter((effect) => effect.sourceUid === ghibli.uid && effect.code === 110)).toEqual([
      expect.objectContaining({ code: 110, controller: 0, event: "continuous", range: ["monsterZone"], sourceUid: ghibli.uid }),
    ]);
    const swappedGhibli = restoredSwapChain.session.state.cards.find((card) => card.uid === ghibli.uid);
    expect(swappedGhibli).toBeDefined();
    const printedAttack = ghibli.data.attack ?? 0;
    const printedDefense = ghibli.data.defense ?? 0;
    expect(currentBaseAttack(swappedGhibli, restoredSwapChain.session.state)).toBe(printedDefense);
    expect(currentAttack(swappedGhibli, restoredSwapChain.session.state)).toBe(printedDefense);
    expect(currentBaseDefense(swappedGhibli, restoredSwapChain.session.state)).toBe(printedAttack);
    expect(currentDefense(swappedGhibli, restoredSwapChain.session.state)).toBe(printedAttack);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor;
  expect(player).toBeDefined();
  const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}
