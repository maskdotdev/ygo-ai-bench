import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { LuaPromptOverride } from "#lua/host-types.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const slimeCode = "80551022";
const deckSummonCode = "805510220";
const offDeckCode = "805510221";
const facedownDecoyCode = "805510222";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSlimeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${slimeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFlip = 0x200000;
const raceAqua = 0x20;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeWater = 0x10;
const attributeDark = 0x20;
const setMimighoul = 0x1b5;
const categorySpecialSummon = 0x200;
const categoryControl = 0x2000;
const categorySet = 0x100000000;

describe.skipIf(!hasUpstreamScripts || !hasSlimeScript)("Lua real script Mimighoul Slime flip deck summon control", () => {
  it("restores SelectEffect self-summon and opponent Deck summon before control transfer", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${slimeCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const summonOpen = createRestoredSelfSummonWindow({ reader, workspace });
    const handSlime = requireCard(summonOpen.session, slimeCode);
    expectCleanRestore(summonOpen);
    expect(summonOpen.session.state.effects.filter((effect) => effect.sourceUid === handSlime.uid).map((effect) => ({
      category: effect.category,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categorySpecialSummon | categoryControl, countLimit: 1, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "flipSummoned" },
      { category: categorySpecialSummon + categorySet, countLimit: 1, event: "ignition", range: ["hand"], triggerEvent: undefined },
    ]);
    expectRestoredLegalActions(summonOpen, 0);
    const selfSummon = getLuaRestoreLegalActions(summonOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handSlime.uid && action.effectId === "lua-2"
    );
    expect(selfSummon, JSON.stringify(getLuaRestoreLegalActions(summonOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(summonOpen, selfSummon!);
    resolveRestoredChain(summonOpen);
    expect(summonOpen.host.promptDecisions.filter((prompt) => prompt.api === "SelectEffect").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      options: "options" in prompt ? prompt.options : [],
      returned: "returned" in prompt ? prompt.returned : undefined,
    }))).toEqual([{ api: "SelectEffect", player: 0, options: [1, 2], returned: 2 }]);
    expect(summonOpen.session.state.cards.find((card) => card.uid === handSlime.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: handSlime.uid,
      reasonEffectId: 2,
    });

    const flipOpen = createRestoredFlipWindow({ reader, workspace });
    const fieldSlime = requireCard(flipOpen.session, slimeCode);
    const deckSummon = requireCard(flipOpen.session, deckSummonCode);
    const offDeck = requireCard(flipOpen.session, offDeckCode);
    expectCleanRestore(flipOpen);
    expectRestoredLegalActions(flipOpen, 0);
    const flip = getLuaRestoreLegalActions(flipOpen, 0).find((action) => action.type === "flipSummon" && action.uid === fieldSlime.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(flipOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(flipOpen, flip!);

    const triggerWindow = restoreDuelWithLuaScripts(serializeDuel(flipOpen.session), workspace, reader, {
      promptOverrides: [{ api: "SelectYesNo", player: 1, returned: true }],
    });
    expectCleanRestore(triggerWindow);
    expectRestoredLegalActions(triggerWindow, 0);
    const flipTrigger = getLuaRestoreLegalActions(triggerWindow, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === fieldSlime.uid && action.effectId === "lua-1"
    );
    expect(flipTrigger, JSON.stringify(getLuaRestoreLegalActions(triggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(triggerWindow, flipTrigger!);

    const chainWindow = restoreDuelWithLuaScripts(serializeDuel(triggerWindow.session), workspace, reader, {
      promptOverrides: [{ api: "SelectYesNo", player: 1, returned: true }],
    });
    expectCleanRestore(chainWindow);
    expectRestoredLegalActions(chainWindow, 1);
    resolveRestoredChain(chainWindow);

    expect(chainWindow.session.state.cards.find((card) => card.uid === deckSummon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: fieldSlime.uid,
      reasonEffectId: 1,
    });
    expect(chainWindow.session.state.cards.find((card) => card.uid === offDeck.uid)).toMatchObject({
      location: "deck",
      controller: 1,
    });
    expect(chainWindow.session.state.cards.find((card) => card.uid === fieldSlime.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: fieldSlime.uid,
      reasonEffectId: 1,
    });
  });
});

function createRestoredSelfSummonWindow({ reader, workspace }: { reader: ReturnType<typeof createCardReader>; workspace: ReturnType<typeof createUpstreamNodeWorkspace> }): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = baseSession(reader, 80551022, { 0: { main: [slimeCode] }, 1: { main: [facedownDecoyCode] } });
  moveDuelCard(session.state, requireCard(session, slimeCode).uid, "hand", 0);
  const decoy = moveDuelCard(session.state, requireCard(session, facedownDecoyCode).uid, "monsterZone", 1);
  decoy.faceUp = false;
  decoy.position = "faceDownDefense";
  return registerAndRestore(session, workspace, reader, [{ api: "SelectEffect", player: 0, returned: 2 }]);
}

function createRestoredFlipWindow({ reader, workspace }: { reader: ReturnType<typeof createCardReader>; workspace: ReturnType<typeof createUpstreamNodeWorkspace> }): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = baseSession(reader, 80551023, { 0: { main: [slimeCode] }, 1: { main: [deckSummonCode, offDeckCode] } });
  const slime = moveDuelCard(session.state, requireCard(session, slimeCode).uid, "monsterZone", 0);
  slime.faceUp = false;
  slime.position = "faceDownDefense";
  return registerAndRestore(session, workspace, reader, [{ api: "SelectYesNo", player: 1, returned: true }]);
}

function baseSession(reader: ReturnType<typeof createCardReader>, seed: number, decks: Parameters<typeof loadDecks>[1]): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, decks);
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function registerAndRestore(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, reader: ReturnType<typeof createCardReader>, promptOverrides: LuaPromptOverride[]): ReturnType<typeof restoreDuelWithLuaScripts> {
  const host = createLuaScriptHost(session, workspace, { promptOverrides });
  expect(host.loadCardScript(Number(slimeCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Mimighoul Slime");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCondition(function() return Duel.IsMainPhase() end)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,1-tp,LOCATION_DECK)");
  expect(script).toContain("Duel.SelectYesNo(p,aux.Stringid(id,2))");
  expect(script).toContain("local sg=g:Select(p,1,1,nil)");
  expect(script).toContain("Duel.SpecialSummon(sg,0,p,p,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.GetControl(c,p)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_SET)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)>Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)");
  expect(script).toContain("Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,1-tp,false,false,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: slimeCode, name: "Mimighoul Slime", kind: "monster", typeFlags: typeMonster | typeEffect | typeFlip, race: raceAqua, attribute: attributeWater, setcodes: [setMimighoul], level: 1, attack: 400, defense: 500 },
    { code: deckSummonCode, name: "Mimighoul Slime Deck Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, setcodes: [setMimighoul], level: 1, attack: 500, defense: 500 },
    { code: offDeckCode, name: "Mimighoul Slime Off Deck", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: facedownDecoyCode, name: "Mimighoul Slime Face-Down Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

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
