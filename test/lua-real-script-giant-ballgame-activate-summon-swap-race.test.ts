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

const upstreamRoot = path.resolve(".upstream/ignis");
const ballgameCode = "60619435";
const graveInsectCode = "606194350";
const revealInsectCode = "606194351";
const ownInsectCode = "606194352";
const opponentMonsterCode = "606194353";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBallgameScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ballgameCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const raceWarrior = 0x1;
const raceInsect = 0x800;
const attributeEarth = 0x1;
const eventFreeChain = 1002;
const effectChangeRace = 122;

describe.skipIf(!hasUpstreamScripts || !hasBallgameScript)("Lua real script Giant Ballgame activate summon swap race", () => {
  it("restores activation flag into Level 6 or lower Insect graveyard Special Summon", () => {
    const { workspace, reader, session } = createFixture(60619435);
    expectScriptShape(workspace.readScript(`official/c${ballgameCode}.lua`) ?? "");
    const ballgame = requireCard(session, ballgameCode);
    const graveInsect = requireCard(session, graveInsectCode);
    const setBallgame = moveDuelCard(session.state, ballgame.uid, "spellTrapZone", 0);
    setBallgame.faceUp = false;
    setBallgame.position = "faceDown";
    setBallgame.turnId = 0;
    moveDuelCard(session.state, graveInsect.uid, "graveyard", 0).faceUp = true;
    prepareMainPhase(session);
    registerBallgame(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === ballgame.uid && action.effectId === `lua-1-${eventFreeChain}`);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === ballgame.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
    });
    expect(restoredOpen.session.state.flagEffects.some((flag) => flag.ownerType === "card" && flag.ownerId === ballgame.uid && flag.code === Number(ballgameCode))).toBe(true);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const revive = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === ballgame.uid && action.effectId === "lua-2");
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, revive!);
    resolveRestoredChain(restoredIgnition);

    expect(restoredIgnition.session.state.cards.find((card) => card.uid === graveInsect.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: ballgame.uid,
      reasonEffectId: 2,
    });
  });

  it("restores hand Insect reveal into SelectUnselectGroup SwapControl and received monster race change", () => {
    const { workspace, reader, session } = createFixture(60619436);
    const ballgame = requireCard(session, ballgameCode);
    const revealInsect = requireCard(session, revealInsectCode);
    const ownInsect = requireCard(session, ownInsectCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    moveDuelCard(session.state, ballgame.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, revealInsect.uid, "hand", 0);
    moveFaceUpAttack(session, ownInsect, 0);
    moveFaceUpAttack(session, opponentMonster, 1);
    prepareMainPhase(session);
    registerBallgame(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === ballgame.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: eventFreeChain, event: "ignition", id: `lua-1-${eventFreeChain}`, property: undefined, range: ["hand", "spellTrapZone"] },
      { category: 0x200, code: undefined, event: "ignition", id: "lua-2", property: undefined, range: ["spellTrapZone"] },
      { category: 0x2000, code: undefined, event: "ignition", id: "lua-3", property: 0x10, range: ["spellTrapZone"] },
    ]);

    const swap = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === ballgame.uid && action.effectId === "lua-3");
    expect(swap, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, swap!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.host.messages).toContain(`confirmed 1: ${revealInsectCode}`);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ownInsect.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ballgame.uid,
      reasonEffectId: 3,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponentMonster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ballgame.uid,
      reasonEffectId: 3,
    });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === opponentMonster.uid && effect.code === effectChangeRace).map((effect) => ({
      code: effect.code,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeRace, sourceUid: opponentMonster.uid, value: raceInsect },
    ]);
  });
});

function createFixture(seed: number): {
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  reader: ReturnType<typeof createCardReader>;
  session: DuelSession;
} {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [ballgameCode, graveInsectCode, revealInsectCode, ownInsectCode] },
    1: { main: [opponentMonsterCode] },
  });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: ballgameCode, name: "Giant Ballgame", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: graveInsectCode, name: "Giant Ballgame Grave Insect", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeEarth, level: 4, attack: 1400, defense: 1000 },
    { code: revealInsectCode, name: "Giant Ballgame Revealed Insect", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeEarth, level: 4, attack: 2200, defense: 1000 },
    { code: ownInsectCode, name: "Giant Ballgame Own Insect", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: opponentMonsterCode, name: "Giant Ballgame Opponent Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("Giant Ballgame");
  expect(script).toContain("e0:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e:GetHandler():RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,EFFECT_FLAG_OATH,1)");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetCondition(function(e) return e:GetHandler():HasFlagEffect(id) end)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("Duel.ShuffleHand(tp)");
  expect(script).toContain("aux.SelectUnselectGroup(g1+g2,e,tp,2,2,s.rescon,1,tp,HINTMSG_CONTROL)");
  expect(script).toContain("Duel.SetTargetCard(tg)");
  expect(script).toContain("Duel.SwapControl(a,b)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_RACE)");
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerBallgame(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ballgameCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
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
