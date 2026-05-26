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
const lightningCode = "56832966";
const utopiaOverlayCode = "568329660";
const genericOverlayCode = "568329661";
const defenderCode = "568329662";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLightningScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lightningCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const setUtopia = 0x107f;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasLightningScript)("Lua real script Utopia the Lightning pre damage detach final stat", () => {
  it("restores Utopia overlay-gated pre-damage detach into 5000 final ATK", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${lightningCode}.lua`));

    const cards: DuelCardData[] = [
      { code: lightningCode, name: "Number S39: Utopia the Lightning", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, setcodes: [setUtopia], race: raceWarrior, attribute: attributeLight, level: 5, attack: 2500, defense: 2000 },
      { code: utopiaOverlayCode, name: "Utopia the Lightning Utopia Overlay", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, setcodes: [setUtopia], race: raceWarrior, attribute: attributeLight, level: 4, attack: 2500, defense: 2000 },
      { code: genericOverlayCode, name: "Utopia the Lightning Generic Overlay", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeLight, level: 5, attack: 1000, defense: 1000 },
      { code: defenderCode, name: "Utopia the Lightning Defender", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 3000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 56832966, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [genericOverlayCode], extra: [lightningCode, utopiaOverlayCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const lightning = requireCard(session, lightningCode);
    const utopiaOverlay = requireCard(session, utopiaOverlayCode);
    const genericOverlay = requireCard(session, genericOverlayCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, lightning, 0);
    moveDuelCard(session.state, utopiaOverlay.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    moveDuelCard(session.state, genericOverlay.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    lightning.overlayUids.push(utopiaOverlay.uid, genericOverlay.uid);
    moveFaceUpAttack(session, defender, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lightningCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.find((effect) => effect.sourceUid === lightning.uid && effect.code === 238)).toMatchObject({
      code: 238,
      event: "continuous",
      sourceUid: lightning.uid,
      value: 1,
    });
    expect(restoredOpen.session.state.effects.find((effect) => effect.sourceUid === lightning.uid && effect.code === 6)).toMatchObject({
      code: 6,
      event: "continuous",
      range: ["monsterZone"],
      sourceUid: lightning.uid,
      targetRange: [0, 1],
      value: 1,
    });

    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === lightning.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    const opponentPass = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "passAttack");
    expect(opponentPass, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, opponentPass!);

    advanceToLightningActivation(restoredOpen, lightning.uid);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === lightning.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === utopiaOverlay.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: lightning.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === genericOverlay.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: lightning.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === lightning.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === lightning.uid)!, restoredOpen.session.state)).toBe(5000);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === lightning.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 1107169344 }, sourceUid: lightning.uid, value: 5000 },
    ]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    finishBattle(restoredBoost);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 2000 });
    expect(restoredBoost.session.state.players[1].lifePoints).toBe(6000);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Number S39: Utopia the Lightning");
  expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_LIGHT),5,3,s.ovfilter,aux.Stringid(id,0))");
  expect(script).toContain("e0:SetCode(EFFECT_CANNOT_BE_XYZ_MATERIAL)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ACTIVATE)");
  expect(script).toContain("Duel.GetAttacker()==c or Duel.GetAttackTarget()==c");
  expect(script).toContain("e2:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e2:SetCost(Cost.AND(Cost.DetachFromSelf(2),Cost.SoftOncePerBattle))");
  expect(script).toContain("c:GetOverlayGroup():IsExists(s.atkconfilter,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(5000)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_DAMAGE_CAL)");
  expect(script).toContain("s.listed_series={SET_UTOPIA}");
  expect(script).toContain("s.xyz_number=39");
}

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

function advanceToLightningActivation(restored: ReturnType<typeof restoreDuelWithLuaScripts>, lightningUid: string): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.uid === lightningUid)) {
    expect(++guard).toBeLessThan(20);
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattleStep(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
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
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      passRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
