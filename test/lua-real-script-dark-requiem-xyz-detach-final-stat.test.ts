import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const darkRequiemCode = "1621413";
const darkRebellionCode = "16195942";
const targetCode = "16214130";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDarkRequiemScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${darkRequiemCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceDragon = 0x2000;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasDarkRequiemScript)("Lua real script Dark Requiem Xyz detach final stat", () => {
  it("restores Dark Rebellion overlay-gated detach into target final ATK zero and self ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${darkRequiemCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,nil,5,3)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1,1,nil))");
    expect(script).toContain("return e:GetHandler():GetOverlayGroup():IsExists(Card.IsCode,1,nil,16195942)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.HasNonZeroAttack,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("local atk=tc:GetBaseAttack()");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(0)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetValue(atk)");

    const cards: DuelCardData[] = [
      { code: darkRequiemCode, name: "Dark Requiem Xyz Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDragon, attribute: attributeDark, level: 5, attack: 3000, defense: 2500 },
      { code: darkRebellionCode, name: "Dark Rebellion Xyz Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDragon, attribute: attributeDark, level: 4, attack: 2500, defense: 2000 },
      { code: targetCode, name: "Dark Requiem Stat Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2400, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1621413, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [darkRequiemCode, darkRebellionCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const darkRequiem = requireCard(session, darkRequiemCode);
    const darkRebellion = requireCard(session, darkRebellionCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, darkRequiem, 0);
    moveDuelCard(session.state, darkRebellion.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    darkRequiem.overlayUids.push(darkRebellion.uid);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(darkRequiemCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === darkRequiem.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    passRestoredChain(restoredOpen);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === darkRebellion.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: darkRequiem.uid,
      reasonEffectId: 2,
    });
    expect(restoredResolved.session.state.cards.find((card) => card.uid === darkRequiem.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === target.uid), restoredResolved.session.state)).toBe(0);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === darkRequiem.uid), restoredResolved.session.state)).toBe(5400);
    expect(restoredResolved.session.state.effects.filter((effect) => [target.uid, darkRequiem.uid].includes(effect.sourceUid) && [100, 102].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 102, property: undefined, reset: { flags: 33427456 }, sourceUid: target.uid, value: 0 },
      { code: 100, property: 0x400, reset: { flags: 33427456 }, sourceUid: darkRequiem.uid, value: 2400 },
    ]);
    expect(restoredResolved.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial" && event.eventCardUid === darkRebellion.uid)).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: darkRebellion.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: darkRequiem.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    restoredResolved.session.state.phase = "battle";
    restoredResolved.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredResolved, 0).find((action) => action.type === "declareAttack" && action.attackerUid === darkRequiem.uid && action.targetUid === target.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredResolved, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResolved, attack!);
    finishBattle(restoredResolved);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 5400 });
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
  const waitingFor = restored.session.state.waitingFor;
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
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0 || restored.session.state.pendingTriggers.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      passRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
