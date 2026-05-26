import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const powercodeCode = "15844566";
const linkedReleaseCode = "158445660";
const targetCode = "158445661";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceCyberse = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Powercode Talker release final disable", () => {
  it("restores target disable and linked release-cost pre-damage final ATK double", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${powercodeCode}.lua`);
    expectScriptShape(script);

    const databaseCards = workspace.readDatabaseCards("cards.cdb");
    const powercodeData = databaseCards.find((card) => card.code === powercodeCode);
    expect(powercodeData).toBeDefined();
    const cards: DuelCardData[] = [
      powercodeData!,
      { code: linkedReleaseCode, name: "Powercode Linked Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, level: 4, attack: 1200, defense: 1000 },
      { code: targetCode, name: "Powercode Negatable Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, level: 4, attack: 2000, defense: 1500 },
    ];
    const reader = createCardReader(cards);

    const restoredDisable = restorePowercodeWindow({ reader, workspace, phase: "main1" });
    const powercode = requireCard(restoredDisable.session, powercodeCode);
    expectCleanRestore(restoredDisable);
    expectRestoredLegalActions(restoredDisable, 0);
    const disable = getLuaRestoreLegalActions(restoredDisable, 0).find((action) => action.type === "activateEffect" && action.uid === powercode.uid);
    expect(disable, JSON.stringify(getLuaRestoreLegalActions(restoredDisable, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDisable, disable!);
    expect(restoredDisable.session.state.chain).toEqual([]);
    const disabledUid = restoredDisable.session.state.eventHistory.find((event) => event.eventName === "becameTarget")?.eventCardUid;
    expect(disabledUid).toBeDefined();
    const disabledTarget = restoredDisable.session.state.cards.find((card) => card.uid === disabledUid);
    expect(disabledTarget).toBeDefined();
    expect(isCardDisabled(restoredDisable.session.state, disabledTarget!, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredDisable.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredDisable.session.state.effects.filter((effect) => effect.sourceUid === disabledTarget!.uid && [2, 8].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 2, event: "continuous", property: 1024, reset: { flags: 1107169792 }, value: undefined },
      { code: 8, event: "continuous", property: 1024, reset: { flags: 1107169792 }, value: 131072 },
    ]);
    expect(restoredDisable.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: disabledTarget!.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        eventPreviousState: { controller: disabledTarget!.controller, faceUp: false, location: disabledTarget!.previousLocation, position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: disabledTarget!.controller, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: disabledTarget!.sequence },
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);

    const restoredBattleOpen = restorePowercodeWindow({ reader, workspace, phase: "battle" });
    expectCleanRestore(restoredBattleOpen);
    expectRestoredLegalActions(restoredBattleOpen, 0);
    const battlePowercode = requireCard(restoredBattleOpen.session, powercodeCode);
    const battleTarget = requireCard(restoredBattleOpen.session, targetCode);
    const attack = getLuaRestoreLegalActions(restoredBattleOpen, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === battlePowercode.uid && action.targetUid === battleTarget.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattleOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleOpen, attack!);
    passRestoredBattleUntil(restoredBattleOpen, () => findRestoredAction(restoredBattleOpen, [1, 0], (action) => action.type === "activateEffect" && action.uid === battlePowercode.uid) !== undefined);

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(restoredBattleOpen.session), workspace, reader);
    expectCleanRestore(restoredPreDamage);
    const preDamagePlayer = restoredPreDamage.session.state.waitingFor ?? restoredPreDamage.session.state.turnPlayer;
    expectRestoredLegalActions(restoredPreDamage, preDamagePlayer);
    expect(restoredPreDamage.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    const quick = findRestoredAction(restoredPreDamage, [1, 0], (action) => action.type === "activateEffect" && action.uid === battlePowercode.uid);
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, preDamagePlayer), null, 2)).toBeDefined();
    expect(quick).toMatchObject({ effectId: "lua-3-1134" });
    applyRestoredActionAndAssert(restoredPreDamage, quick!);
    resolveRestoredChain(restoredPreDamage);
    const released = requireCard(restoredPreDamage.session, linkedReleaseCode);
    expect(released).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: battlePowercode.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredPreDamage.session.state.cards.find((card) => card.uid === battlePowercode.uid), restoredPreDamage.session.state)).toBe(4600);
    expect(restoredPreDamage.session.state.eventHistory.filter((event) => event.eventName === "released")).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: released.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: battlePowercode.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredPreDamage.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function restorePowercodeWindow({
  reader,
  workspace,
  phase,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  phase: "main1" | "battle";
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: phase === "battle" ? 15844567 : 15844566, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [linkedReleaseCode], extra: [powercodeCode] }, 1: { main: [targetCode] } });
  startDuel(session);

  const powercode = requireCard(session, powercodeCode);
  const linkedRelease = requireCard(session, linkedReleaseCode);
  const target = requireCard(session, targetCode);
  moveFaceUpAttack(session, powercode, 0, 2);
  powercode.summonType = "link";
  powercode.summonPlayer = 0;
  moveFaceUpAttack(session, linkedRelease, 0, 3);
  moveFaceUpAttack(session, target, 1, 0);
  session.state.phase = phase;
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(powercodeCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Link.AddProcedure(c,nil,3,3)");
  expect(script).toContain("e1:SetCategory(CATEGORY_DISABLE)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsNegatableMonster,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.NegateRelatedChain(tc,RESET_TURN_SET)");
  expect(script).toContain("e2:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("return e:GetHandler():GetBattleTarget()~=nil");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,nil,nil,lg)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,nil,nil,lg)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.position = "faceUpAttack";
  moved.faceUp = true;
  return moved;
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

function findRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, players: PlayerId[], predicate: (action: DuelAction) => boolean): DuelAction | undefined {
  for (const player of players) {
    const action = getLuaRestoreLegalActions(restored, player).find(predicate);
    if (action) return action;
  }
  return undefined;
}

function passRestoredBattleUntil(restored: ReturnType<typeof restoreDuelWithLuaScripts>, done: () => boolean): void {
  let guard = 0;
  while (!done()) {
    expect(++guard).toBeLessThan(30);
    resolveRestoredChainIfOpen(restored);
    if (done()) return;
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function resolveRestoredChainIfOpen(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  if (restored.session.state.chain.length === 0) return;
  resolveRestoredChain(restored);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    passRestoredChain(restored);
  }
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor;
  expect(player).toBeDefined();
  const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}
