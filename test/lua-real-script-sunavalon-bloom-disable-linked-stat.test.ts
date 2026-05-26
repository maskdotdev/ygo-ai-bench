import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const bloomCode = "54340229";
const linkCode = "543402290";
const linkedPlantCode = "543402291";
const opponentEffectCode = "543402292";
const secondOpponentEffectCode = "543402293";
const defenderCode = "543402294";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasBloomScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${bloomCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const typeLink = 0x4000000;
const racePlant = 0x400;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const effectDisable = 2;
const effectDisableEffect = 8;
const effectUpdateAttack = 100;
const resetEventStandard = 33427456;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasBloomScript)("Lua real script Sunavalon Bloom disable linked stat", () => {
  it("restores activation disable sweep and linked-group pre-damage ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${bloomCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const disableSession = createDuel({ seed: 54340229, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(disableSession, { 0: { main: [bloomCode], extra: [linkCode] }, 1: { main: [opponentEffectCode, secondOpponentEffectCode] } });
    startDuel(disableSession);
    const disableBloom = requireCard(disableSession, bloomCode);
    const disableLink = requireCard(disableSession, linkCode);
    const opponentEffect = requireCard(disableSession, opponentEffectCode);
    const secondOpponentEffect = requireCard(disableSession, secondOpponentEffectCode);
    moveFaceDownSpellTrap(disableSession, disableBloom, 0, 0);
    moveFaceUpAttack(disableSession, disableLink, 0, 0);
    moveFaceUpAttack(disableSession, opponentEffect, 1, 0);
    moveFaceUpAttack(disableSession, secondOpponentEffect, 1, 1);
    disableSession.state.phase = "main1";
    disableSession.state.turnPlayer = 0;
    disableSession.state.waitingFor = 0;

    const disableHost = createLuaScriptHost(disableSession, workspace);
    expect(disableHost.loadCardScript(Number(bloomCode), workspace).ok).toBe(true);
    expect(disableHost.registerInitialEffects()).toBe(1);

    const restoredDisable = restoreDuelWithLuaScripts(serializeDuel(disableSession), workspace, reader);
    expectCleanRestore(restoredDisable);
    expectRestoredLegalActions(restoredDisable, 0);
    const activate = getLuaRestoreLegalActions(restoredDisable, 0).find((action) =>
      action.type === "activateEffect" && action.uid === disableBloom.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredDisable, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDisable, activate!);
    resolveRestoredChain(restoredDisable);

    expect(restoredDisable.session.state.effects.filter((effect) =>
      [opponentEffect.uid, secondOpponentEffect.uid].includes(effect.sourceUid) && [effectDisable, effectDisableEffect].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    })).sort((left, right) => left.sourceUid.localeCompare(right.sourceUid) || (left.code ?? 0) - (right.code ?? 0))).toEqual([
      { code: effectDisable, range: ["monsterZone"], reset: { flags: resetEventStandard }, sourceUid: opponentEffect.uid },
      { code: effectDisableEffect, range: ["monsterZone"], reset: { flags: resetEventStandard }, sourceUid: opponentEffect.uid },
      { code: effectDisable, range: ["monsterZone"], reset: { flags: resetEventStandard }, sourceUid: secondOpponentEffect.uid },
      { code: effectDisableEffect, range: ["monsterZone"], reset: { flags: resetEventStandard }, sourceUid: secondOpponentEffect.uid },
    ]);

    const statSession = createDuel({ seed: 54340230, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(statSession, { 0: { main: [bloomCode, linkedPlantCode], extra: [linkCode] }, 1: { main: [defenderCode] } });
    startDuel(statSession);
    const statBloom = requireCard(statSession, bloomCode);
    const statLink = requireCard(statSession, linkCode);
    const linkedPlant = requireCard(statSession, linkedPlantCode);
    const defender = requireCard(statSession, defenderCode);
    moveFaceUpSpellTrap(statSession, statBloom, 0, 0);
    moveFaceUpAttack(statSession, statLink, 0, 0);
    moveFaceUpAttack(statSession, linkedPlant, 0, 1);
    moveFaceUpAttack(statSession, defender, 1, 0);
    statSession.state.phase = "battle";
    statSession.state.turnPlayer = 0;
    statSession.state.waitingFor = 0;

    const statHost = createLuaScriptHost(statSession, workspace);
    expect(statHost.loadCardScript(Number(bloomCode), workspace).ok).toBe(true);
    expect(statHost.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(statSession), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === statLink.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passUntilBattleWindow(restoredBattle, "beforeDamageCalculation");
    expect(restoredBattle.session.state.pendingBattle).toMatchObject({ attackerUid: statLink.uid, targetUid: defender.uid });
    if (restoredBattle.session.state.waitingFor === 1) {
      const pass = getLuaRestoreLegalActions(restoredBattle, 1).find((action) => action.type === "passDamage");
      expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
      applyRestoredActionAndAssert(restoredBattle, pass!);
    }

    const boost = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "activateEffect" && action.uid === statBloom.uid && action.effectId === "lua-2-1134"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, boost!);
    resolveRestoredChain(restoredBattle);

    expect(currentAttack(findCard(restoredBattle.session, statLink.uid), restoredBattle.session.state)).toBe(2800);
    expect(restoredBattle.session.state.effects.filter((effect) =>
      effect.sourceUid === statLink.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: statLink.uid, value: 800 },
    ]);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const bloom = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === bloomCode);
  expect(bloom).toBeDefined();
  return [
    { ...bloom!, kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: linkCode, name: "Sunavalon Bloom Plant Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: racePlant, attribute: attributeEarth, level: 4, attack: 2000, defense: 0, linkMarkers: 0x20 },
    { code: linkedPlantCode, name: "Sunavalon Bloom Linked Plant", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeEarth, level: 4, attack: 800, defense: 1000 },
    { code: opponentEffectCode, name: "Sunavalon Bloom Opponent Effect A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
    { code: secondOpponentEffectCode, name: "Sunavalon Bloom Opponent Effect B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
    { code: defenderCode, name: "Sunavalon Bloom Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Sunavalon Bloom");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("e2:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_LINK) and c:IsRace(RACE_PLANT) and c:IsLinkAbove(4)");
  expect(script).toContain("local g=Duel.GetMatchingGroup(s.filter,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("for tc in aux.Next(g) do");
  expect(script).toContain("e1:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE_EFFECT)");
  expect(script).toContain("Duel.GetAttackTarget()");
  expect(script).toContain("Duel.GetAttacker()");
  expect(script).toContain("c:GetLinkedGroup():Filter(Card.IsFaceup,nil):GetSum(Card.GetAttack)>0");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(lg:GetSum(Card.GetAttack))");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceDownSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = false;
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.sequence = sequence;
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passUntilBattleWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, kind: NonNullable<DuelSession["state"]["battleWindow"]>["kind"]): void {
  let guard = 0;
  while (restored.session.state.battleWindow?.kind !== kind) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain" || action.type === "passAttack" || action.type === "passDamage");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
