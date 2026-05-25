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
const miracleCode = "55985014";
const heroKidCode = "32679370";
const targetCode = "559850140";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasMiracleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${miracleCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const effectUpdateAttack = 100;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasMiracleScript)("Lua real script Miracle Kids grave count stat", () => {
  it("restores Hero Kid grave count into opponent target attack loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${miracleCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restored = createRestoredField({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const miracle = requireCard(restored.session, miracleCode);
    const target = requireCard(restored.session, targetCode);
    const heroes = requireCards(restored.session, heroKidCode);
    expect(heroes).toHaveLength(2);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === miracle.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(heroes.map((hero) => findCard(restored.session, hero.uid).location)).toEqual(["graveyard", "graveyard"]);
    expect(currentAttack(findCard(restored.session, target.uid), restored.session.state)).toBe(1400);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetStandardPhaseEnd }, sourceUid: target.uid, value: -800 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 1, previous: "deck", current: "monsterZone" },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const database = workspace.readDatabaseCards("cards.cdb");
  const miracle = database.find((card) => card.code === miracleCode);
  const heroKid = database.find((card) => card.code === heroKidCode);
  expect(miracle).toBeDefined();
  expect(heroKid).toBeDefined();
  return [
    { ...miracle!, kind: "trap", typeFlags: typeTrap },
    { ...heroKid!, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth },
    { code: targetCode, name: "Miracle Kids Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2200, defense: 1600 },
  ];
}

function createRestoredField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 55985014, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [miracleCode, heroKidCode, heroKidCode] }, 1: { main: [targetCode] } });
  startDuel(session);
  moveFaceDownSpellTrap(session, requireCard(session, miracleCode), 0, 0);
  for (const hero of requireCards(session, heroKidCode)) moveToGraveyard(session, hero, 0);
  moveFaceUpAttack(session, requireCard(session, targetCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(miracleCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Miracle Kids");
  expect(script).toContain("s.listed_names={32679370}");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsCode,tp,LOCATION_GRAVE,0,1,nil,32679370)");
  expect(script).toContain("Duel.IsExistingTarget(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("local tc=Duel.GetFirstTarget()");
  expect(script).toContain("local val=Duel.GetMatchingGroupCount(Card.IsCode,tp,LOCATION_GRAVE,0,nil,32679370)*400");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e1:SetValue(-val)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function requireCards(session: DuelSession, code: string): DuelCardInstance[] {
  const cards = session.state.cards.filter((candidate) => candidate.code === code);
  expect(cards.length).toBeGreaterThan(0);
  return cards;
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

function moveToGraveyard(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "graveyard", player);
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
    applyRestoredActionAndAssert(restored, pass!);
  }
}
