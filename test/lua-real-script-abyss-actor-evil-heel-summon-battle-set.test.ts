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
const evilHeelCode = "52240819";
const allyCode = "522408190";
const opponentCode = "522408191";
const scriptCode = "522408192";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasEvilHeelScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${evilHeelCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const typeSpell = 0x2;
const setAbyssActor = 0x10ec;
const setAbyssScript = 0x20ec;
const raceFiend = 0x8;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasEvilHeelScript)("Lua real script Abyss Actor Evil Heel summon battle set", () => {
  it("restores summon-success target ATK loss from face-up Abyss Actor count", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${evilHeelCode}.lua`));
    const reader = createCardReader(cards());
    const session = createEvilHeelSession(reader, workspace);
    const evilHeel = requireCard(session, evilHeelCode);
    const ally = requireCard(session, allyCode);
    const opponent = requireCard(session, opponentCode);
    moveFaceUpAttack(session, evilHeel, 0);
    moveFaceUpAttack(session, ally, 0);
    moveFaceUpAttack(session, opponent, 1);

    const raised = createLuaScriptHost(session, workspace).loadScript(
      `
        local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${evilHeelCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
        Duel.RaiseEvent(c,EVENT_SUMMON_SUCCESS,nil,REASON_SUMMON,0,0,0)
        Debug.Message("evil heel summon success raised")
      `,
      "evil-heel-summon-success.lua",
    );
    expect(raised.ok, raised.error).toBe(true);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === evilHeel.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponent.uid), restoredTrigger.session.state)).toBe(-200);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === opponent.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: 100, reset: { flags: 1107169792 }, sourceUid: opponent.uid, value: -2000 }]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "becameTarget" && event.eventCardUid === opponent.uid)).toHaveLength(1);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === opponent.uid), restoredStat.session.state)).toBe(-200);
  });

  it("restores battle-destroying trigger into Abyss Script Set from Graveyard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${evilHeelCode}.lua`));
    const reader = createCardReader(cards());
    const session = createEvilHeelSession(reader, workspace);
    const evilHeel = requireCard(session, evilHeelCode);
    const opponent = requireCard(session, opponentCode);
    const script = requireCard(session, scriptCode);
    moveFaceUpAttack(session, evilHeel, 0);
    moveFaceUpAttack(session, opponent, 1);
    moveDuelCard(session.state, script.uid, "graveyard", 0);
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === evilHeel.uid && action.targetUid === opponent.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passBattle(restoredBattle);

    expect(restoredBattle.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({ location: "graveyard" });
    expectRestoredLegalActions(restoredBattle, 0);
    const setTrigger = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "activateTrigger" && action.uid === evilHeel.uid);
    expect(setTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, setTrigger!);
    resolveRestoredChain(restoredBattle);

    expect(restoredBattle.session.state.cards.find((card) => card.uid === script.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: false,
      position: "faceDown",
    });
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "spellTrapSet" && event.eventCardUid === script.uid)).toEqual([
      {
        eventName: "spellTrapSet",
        eventCode: 1107,
        eventCardUid: script.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.atkcfilter,1,false,aux.ReleaseCheckTarget,nil,dg)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.atkcfilter,1,1,false,aux.ReleaseCheckTarget,nil,dg)");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.GetMatchingGroupCount(s.atkfilter,tp,LOCATION_MZONE,0,nil)*1000");
  expect(script).toContain("e4:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("e4:SetCondition(aux.bdocon)");
  expect(script).toContain("Duel.SelectTarget(tp,s.cfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SSet(tp,tc)");
}

function cards(): DuelCardData[] {
  return [
    { code: evilHeelCode, name: "Abyss Actor - Evil Heel", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, setcodes: [setAbyssActor], race: raceFiend, attribute: attributeDark, level: 8, attack: 3000, defense: 2000 },
    { code: allyCode, name: "Abyss Actor Ally", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setAbyssActor], race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: opponentCode, name: "Abyss Actor Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: scriptCode, name: "Abyss Script Fixture", kind: "spell", typeFlags: typeSpell, setcodes: [setAbyssScript] },
  ];
}

function createEvilHeelSession(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelSession {
  const session = createDuel({ seed: 52240819, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [evilHeelCode, allyCode, scriptCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(evilHeelCode), workspace).ok).toBe(true);
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

function passBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passAttack" || candidate.type === "passDamage" || candidate.type === "passChain");
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
}
