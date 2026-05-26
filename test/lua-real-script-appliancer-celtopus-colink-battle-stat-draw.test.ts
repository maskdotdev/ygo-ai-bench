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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const celtopusCode = "78225596";
const hasCeltopusScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${celtopusCode}.lua`));
const attackerCode = "782255960";
const targetCode = "782255961";
const drawCardCode = "782255962";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const setAppliancer = 0x14a;

describe.skipIf(!hasUpstreamScripts || !hasCeltopusScript)("Lua real script Appliancer Celtopus co-link battle stat draw", () => {
  it("restores co-linked pre-damage Appliancer ATK boost and target locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${celtopusCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BE_BATTLE_TARGET)");
    expect(script).toContain("e1:SetValue(aux.imval1)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
    expect(script).toContain("e2:SetValue(aux.tgoval)");
    expect(script).toContain("e3:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("local mg=a:GetMutualLinkedGroup()");
    expect(script).toContain("local octg=e:GetHandler():GetMutualLinkedGroup()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(atkct*1000)");
    expect(script).toContain("e4:SetCode(EVENT_LEAVE_FIELD_P)");
    expect(script).toContain("e5:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("Duel.SetTargetPlayer(tp)");
    expect(script).toContain("Duel.SetTargetParam(1)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");

    const cards: DuelCardData[] = [
      { code: celtopusCode, name: "Appliancer Celtopus", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, setcodes: [setAppliancer], level: 2, attack: 0, defense: 0, linkMarkers: 0x28 },
      { code: attackerCode, name: "Appliancer Co-linked Attacker", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, setcodes: [setAppliancer], level: 1, attack: 1500, defense: 0, linkMarkers: 0x20 },
      { code: targetCode, name: "Celtopus Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
      { code: drawCardCode, name: "Celtopus Draw Card", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 78225596, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [drawCardCode], extra: [celtopusCode, attackerCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const celtopus = requireCard(session, celtopusCode);
    const attacker = requireCard(session, attackerCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, celtopus.uid, 0, 1);
    moveFaceUpAttack(session, attacker.uid, 0, 0);
    moveFaceUpAttack(session, target.uid, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(celtopusCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === celtopus.uid && effect.code !== undefined && [70, 71].includes(effect.code)).map((effect) => ({
      code: effect.code,
      range: effect.range,
      valuePredicate: typeof effect.valuePredicate,
    }))).toEqual([
      { code: 70, range: ["monsterZone"], valuePredicate: "function" },
      { code: 71, range: ["monsterZone"], valuePredicate: "function" },
    ]);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === target.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    passUntilPendingTrigger(restoredBattle.session);
    expect(restoredBattle.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredPreDamage);
    expectRestoredLegalActions(restoredPreDamage, 0);
    const trigger = getLuaRestoreLegalActions(restoredPreDamage, 0).find((action) => action.type === "activateTrigger" && action.uid === celtopus.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPreDamage, trigger!);
    expect(currentAttack(restoredPreDamage.session.state.cards.find((card) => card.uid === attacker.uid), restoredPreDamage.session.state)).toBe(2500);
    expect(restoredPreDamage.session.state.effects.filter((effect) => effect.sourceUid === attacker.uid && effect.code === 100).map((effect) => ({
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
        eventCardUid: attacker.uid,
        eventUids: [attacker.uid, target.uid],
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, uid: string, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, uid, "monsterZone", player);
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
