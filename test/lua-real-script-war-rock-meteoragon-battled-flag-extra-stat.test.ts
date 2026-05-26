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
const meteoragonCode = "10497636";
const allyCode = "104976360";
const defenderCode = "104976361";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMeteoragonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${meteoragonCode}.lua`));
const setWarRock = 0x161;
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const effectExtraAttackMonster = 346;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasMeteoragonScript)("Lua real script War Rock Meteoragon battled flag extra stat", () => {
  it("restores battled Earth Warrior flag into extra monster attack and War Rock ATK boosts", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${meteoragonCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restoredBattle = createRestoredMeteoragonField({ reader, workspace });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const meteoragon = requireCard(restoredBattle.session, meteoragonCode);
    const ally = requireCard(restoredBattle.session, allyCode);
    const defender = requireCard(restoredBattle.session, defenderCode);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === ally.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passBattleUntilComplete(restoredBattle);
    expect(restoredBattle.session.state.flagEffects).toEqual([
      expect.objectContaining({ ownerType: "player", ownerId: "0", code: Number(meteoragonCode), value: 0 }),
    ]);

    const restoredQuick = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    const quick = getLuaRestoreLegalActions(restoredQuick, 0).find((action) =>
      action.type === "activateEffect" && action.uid === meteoragon.uid
    );
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, quick!);
    resolveRestoredChain(restoredQuick);

    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === meteoragon.uid), restoredQuick.session.state)).toBe(2800);
    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === ally.uid), restoredQuick.session.state)).toBe(1800);
    expect(restoredQuick.session.state.effects.filter((effect) =>
      [meteoragon.uid, ally.uid].includes(effect.sourceUid ?? "") && [effectExtraAttackMonster, effectUpdateAttack].includes(effect.code ?? 0)
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectExtraAttackMonster, event: "continuous", property: 0x20000, range: ["monsterZone"], reset: { flags: 1107235328 }, sourceUid: meteoragon.uid, value: 1 },
      { code: effectUpdateAttack, event: "continuous", property: 0x400, range: ["monsterZone"], reset: { flags: 1644040704 }, sourceUid: meteoragon.uid, value: 200 },
      { code: effectUpdateAttack, event: "continuous", property: 0x400, range: ["monsterZone"], reset: { flags: 1644040704 }, sourceUid: ally.uid, value: 200 },
    ]);
    expect(restoredQuick.session.state.eventHistory.filter((event) => ["afterDamageCalculation", "battleDamageDealt", "battleDestroyed", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "battleDamageDealt", eventCode: 1143, eventCardUid: ally.uid, eventPlayer: 1, eventValue: 400, eventReason: duelReason.battle, eventReasonPlayer: 0, eventReasonCardUid: ally.uid, eventReasonEffectId: undefined, relatedEffectId: undefined },
      { eventName: "afterDamageCalculation", eventCode: 1138, eventCardUid: ally.uid, eventPlayer: undefined, eventValue: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined },
      { eventName: "battleDestroyed", eventCode: 1140, eventCardUid: defender.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: ally.uid, eventReasonEffectId: undefined, relatedEffectId: undefined },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventPlayer: 0, eventValue: 1, eventReason: undefined, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3 },
    ]);
    expect(restoredQuick.session.state.battleDamage).toEqual({ 0: 0, 1: 400 });
  });
});

function createRestoredMeteoragonField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 10497636, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [meteoragonCode, allyCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, meteoragonCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(meteoragonCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("War Rock Meteoragon");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("e1:SetValue(aux.indoval)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("Duel.SetTargetCard(e:GetHandler():GetBattleTarget())");
  expect(script).toContain("Duel.AdjustInstantly(c)");
  expect(script).toContain("e4:SetCode(EVENT_CHAIN_SOLVING)");
  expect(script).toContain("Duel.NegateEffect(ev)");
  expect(script).toContain("aux.GlobalCheck(s,function()");
  expect(script).toContain("ge1:SetCode(EVENT_BATTLED)");
  expect(script).toContain("Duel.RegisterFlagEffect(bc0:GetControler(),id,RESET_PHASE|PHASE_END,0,1)");
  expect(script).toContain("e3:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("return Duel.IsBattlePhase() and Duel.GetFlagEffect(tp,id)>0");
  expect(script).toContain("Duel.GetFlagEffect(tp,id)>0");
  expect(script).toContain("e1:SetCode(EFFECT_EXTRA_ATTACK_MONSTER)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e2:SetValue(200)");
}

function cards(): DuelCardData[] {
  return [
    { code: meteoragonCode, name: "War Rock Meteoragon", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setWarRock], race: raceWarrior, attribute: attributeEarth, level: 7, attack: 2600, defense: 2600 },
    { code: allyCode, name: "War Rock Meteoragon Ally", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setWarRock], race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: defenderCode, name: "War Rock Meteoragon Defender", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence = 0): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function passBattleUntilComplete(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
