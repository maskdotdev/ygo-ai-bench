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
const spentaCode = "42544773";
const searchCode = "425447730";
const ownMonsterCode = "425447731";
const opponentMonsterCode = "425447732";
const equipCode = "425447733";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSpentaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${spentaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const raceSpellcaster = 0x2;
const setMagistus = 0x152;

describe.skipIf(!hasUpstreamScripts || !hasSpentaScript)("Lua real script Spenta SelectEffect search stat equip", () => {
  it("restores hand SelfDiscard SelectEffect search and attack-halving branches", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${spentaCode}.lua`));
    const reader = createCardReader(cards());

    const searchSession = createSpentaSession(reader, workspace);
    const searchSpenta = requireCard(searchSession, spentaCode);
    const searchTarget = requireCard(searchSession, searchCode);
    const searchOpponent = requireCard(searchSession, opponentMonsterCode);
    moveDuelCard(searchSession.state, searchSpenta.uid, "hand", 0);
    moveFaceUpAttack(searchSession, searchOpponent, 1);
    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(searchSession), workspace, reader, {
      promptOverrides: [{ api: "SelectEffect", player: 0, returned: 1 }],
    });
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const searchAction = getLuaRestoreLegalActions(restoredSearch, 0).find((action) => action.type === "activateEffect" && action.uid === searchSpenta.uid);
    expect(searchAction, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, searchAction!);
    resolveRestoredChain(restoredSearch);
    expect(restoredSearch.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1, 2], descriptions: [680716370, 680716371], returned: 1 },
    ]);
    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchSpenta.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: searchSpenta.uid,
      reasonEffectId: 1,
    });
    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: searchSpenta.uid,
      reasonEffectId: 1,
    });
    expect(restoredSearch.host.messages).toContain(`confirmed 1: ${searchCode}`);

    const statSession = createSpentaSession(reader, workspace);
    const statSpenta = requireCard(statSession, spentaCode);
    const statOpponent = requireCard(statSession, opponentMonsterCode);
    moveDuelCard(statSession.state, statSpenta.uid, "hand", 0);
    moveFaceUpAttack(statSession, statOpponent, 1);
    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(statSession), workspace, reader, {
      promptOverrides: [{ api: "SelectEffect", player: 0, returned: 2 }],
    });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const statAction = getLuaRestoreLegalActions(restoredStat, 0).find((action) => action.type === "activateEffect" && action.uid === statSpenta.uid);
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, statAction!);
    resolveRestoredChain(restoredStat);
    expect(restoredStat.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1, 2], descriptions: [680716370, 680716371], returned: 2 },
    ]);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === statOpponent.uid), restoredStat.session.state)).toBe(1200);
    expect(restoredStat.session.state.effects.filter((effect) => effect.code === 102).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 102, property: 0x400, reset: { flags: 1107169792 }, value: 1200 },
    ]);
  });

  it("restores grave SelfBanish target equip from Extra Deck to a face-up monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${spentaCode}.lua`));
    const reader = createCardReader(cards());
    const session = createSpentaSession(reader, workspace);
    const spenta = requireCard(session, spentaCode);
    const ownMonster = requireCard(session, ownMonsterCode);
    const equip = requireCard(session, equipCode);
    moveDuelCard(session.state, spenta.uid, "graveyard", 0);
    moveFaceUpAttack(session, ownMonster, 0);

    const restoredEquip = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredEquip);
    expectRestoredLegalActions(restoredEquip, 0);
    const equipAction = getLuaRestoreLegalActions(restoredEquip, 0).find((action) => action.type === "activateEffect" && action.uid === spenta.uid);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquip, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEquip, equipAction!);
    resolveRestoredChain(restoredEquip);
    expect(restoredEquip.session.state.cards.find((card) => card.uid === spenta.uid)).toMatchObject({
      location: "banished",
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: spenta.uid,
      reasonEffectId: 2,
    });
    expect(restoredEquip.session.state.cards.find((card) => card.uid === equip.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      equippedToUid: ownMonster.uid,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: spenta.uid,
      reasonEffectId: 2,
    });
    expect(restoredEquip.session.state.effects.filter((effect) => effect.code === 76).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      valueType: typeof effect.value,
    }))).toEqual([
      { code: 76, property: 0x400, reset: { flags: 33427456 }, valueType: "undefined" },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCost(Cost.SelfDiscard)");
  expect(script).toContain("Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.eqfilter),tp,LOCATION_EXTRA|LOCATION_GRAVE,0,1,1,nil,tp):GetFirst()");
  expect(script).toContain("Duel.Equip(tp,ec,tc)");
  expect(script).toContain("e1:SetCode(EFFECT_EQUIP_LIMIT)");
}

function cards(): DuelCardData[] {
  return [
    { code: spentaCode, name: "Spenta, the Magistus Sealer", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, setcodes: [setMagistus], level: 4, attack: 1200, defense: 1800 },
    { code: searchCode, name: "Spenta Search Magistus", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, setcodes: [setMagistus], level: 4, attack: 1000, defense: 1000 },
    { code: ownMonsterCode, name: "Spenta Equip Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, level: 4, attack: 1600, defense: 1000 },
    { code: opponentMonsterCode, name: "Spenta Opponent Stat Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, level: 4, attack: 2400, defense: 1000 },
    { code: equipCode, name: "Spenta Extra Deck Magistus Equip", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceSpellcaster, setcodes: [setMagistus], level: 4, attack: 1800, defense: 1000 },
  ];
}

function createSpentaSession(reader: ReturnType<typeof createCardReader>, source: { readScript(name: string): string | undefined }): DuelSession {
  const session = createDuel({ seed: 42544773, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [spentaCode, searchCode, ownMonsterCode], extra: [equipCode] }, 1: { main: [opponentMonsterCode] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, source);
  expect(host.loadCardScript(Number(spentaCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
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
