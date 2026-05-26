import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const allianceCode = "58116537";
const ownWarriorOneCode = "581165370";
const ownWarriorTwoCode = "581165371";
const ownChainStarterCode = "581165372";
const opponentEarthCode = "581165373";
const opponentFireCode = "581165374";
const opponentSpecialCode = "581165375";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAllianceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${allianceCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const setAncientWarriors = 0x137;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeFire = 0x4;
const effectCannotTrigger = 7;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasAllianceScript)("Lua real script Ancient Warriors Saga Sun-Liu Alliance announce chain stat", () => {
  it("restores announced Attribute trigger locks and opponent Special Summon ATK boosts", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${allianceCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());

    const announce = createRestoredField(reader, source, workspace);
    expectCleanRestore(announce.restored);
    expectRestoredLegalActions(announce.restored, 0);
    const announceAction = getLuaRestoreLegalActions(announce.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === announce.alliance.uid
    );
    expect(announceAction, JSON.stringify(getLuaRestoreLegalActions(announce.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(announce.restored, announceAction!);
    resolveRestoredChain(announce.restored);

    expect(announce.restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "AnnounceAttribute", player: 0, options: [attributeEarth, attributeFire], descriptions: [attributeEarth, attributeFire], returned: attributeEarth },
    ]);
    expect(announce.restored.session.state.effects.filter((effect) =>
      effect.sourceUid === announce.opponentEarth.uid && effect.code === effectCannotTrigger
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotTrigger, event: "continuous", reset: { flags: 1107169792 }, sourceUid: announce.opponentEarth.uid, value: 1 },
    ]);
    expect(announce.restored.session.state.effects.some((effect) =>
      effect.sourceUid === announce.opponentFire.uid && effect.code === effectCannotTrigger
    )).toBe(false);

    const restoredAnnounceResolved = restoreDuelWithLuaScripts(serializeDuel(announce.restored.session), source, reader);
    expectCleanRestore(restoredAnnounceResolved);
    expectRestoredLegalActions(restoredAnnounceResolved, 0);
    expect(restoredAnnounceResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const summon = createRestoredField(reader, source, workspace);
    summon.restored.session.state.turnPlayer = 1;
    summon.restored.session.state.waitingFor = 1;
    const specialAction = getLuaRestoreLegalActions(summon.restored, 1).find((action) =>
      action.type === "activateEffect" && action.uid === summon.opponentSpecial.uid
    );
    expect(specialAction, JSON.stringify(getLuaRestoreLegalActions(summon.restored, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(summon.restored, specialAction!);
    resolveRestoredChain(summon.restored);
    expect(findCard(summon.restored.session, summon.opponentSpecial.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 1,
      reasonCardUid: summon.opponentSpecial.uid,
    });

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(summon.restored.session), source, reader);
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    const summonBoost = getLuaRestoreLegalActions(restoredSummonTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === summon.alliance.uid
    );
    expect(summonBoost, JSON.stringify(getLuaRestoreLegalActions(restoredSummonTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonTrigger, summonBoost!);
    resolveRestoredChain(restoredSummonTrigger);

    expect(currentAttack(findCard(restoredSummonTrigger.session, summon.ownWarriorOne.uid), restoredSummonTrigger.session.state)).toBe(2100);
    expect(currentAttack(findCard(restoredSummonTrigger.session, summon.ownWarriorTwo.uid), restoredSummonTrigger.session.state)).toBe(1900);
    expect(currentAttack(findCard(restoredSummonTrigger.session, summon.ownChainStarter.uid), restoredSummonTrigger.session.state)).toBe(1500);
    expect(restoredSummonTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: summon.opponentSpecial.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: summon.opponentSpecial.uid, eventReasonPlayer: 1 },
    ]);
    expect(restoredSummonTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

type ScriptSource = { readScript(name: string): string | undefined };

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Ancient Warriors Saga - Sun-Liu Alliance");
  expect(script).toContain("Duel.AnnounceAttribute(tp,1,att)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_TRIGGER)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e5:SetCode(EVENT_CHAINING)");
  expect(script).toContain("return rp==tp and re:GetHandler():IsSetCard(SET_ANCIENT_WARRIORS) and re:GetHandler():IsMonster()");
  expect(script).toContain("tc:UpdateAttack(#g*300,RESETS_STANDARD_PHASE_END,c)");
}

function createRestoredField(
  reader: ReturnType<typeof createCardReader>,
  source: ScriptSource,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>
): {
  restored: ReturnType<typeof restoreDuelWithLuaScripts>;
  alliance: DuelCardInstance;
  ownWarriorOne: DuelCardInstance;
  ownWarriorTwo: DuelCardInstance;
  ownChainStarter: DuelCardInstance;
  opponentEarth: DuelCardInstance;
  opponentFire: DuelCardInstance;
  opponentSpecial: DuelCardInstance;
} {
  const session = createDuel({ seed: 58116537, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [allianceCode, ownWarriorOneCode, ownWarriorTwoCode, ownChainStarterCode] },
    1: { main: [opponentEarthCode, opponentFireCode, opponentSpecialCode] },
  });
  startDuel(session);
  const alliance = requireCard(session, allianceCode);
  const ownWarriorOne = requireCard(session, ownWarriorOneCode);
  const ownWarriorTwo = requireCard(session, ownWarriorTwoCode);
  const ownChainStarter = requireCard(session, ownChainStarterCode);
  const opponentEarth = requireCard(session, opponentEarthCode);
  const opponentFire = requireCard(session, opponentFireCode);
  const opponentSpecial = requireCard(session, opponentSpecialCode);
  moveFaceUpSpell(session, alliance, 0, 0);
  moveFaceUpAttack(session, ownWarriorOne, 0, 0);
  moveFaceUpAttack(session, ownWarriorTwo, 0, 1);
  moveFaceUpAttack(session, ownChainStarter, 0, 2);
  moveFaceUpAttack(session, opponentEarth, 1, 0);
  moveFaceUpAttack(session, opponentFire, 1, 1);
  moveDuelCard(session.state, opponentSpecial.uid, "hand", 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  for (const code of [allianceCode, opponentSpecialCode]) {
    const loaded = host.loadCardScript(Number(code), source);
    expect(loaded.ok, loaded.error).toBe(true);
  }
  expect(host.registerInitialEffects()).toBe(2);
  return {
    restored: restoreDuelWithLuaScripts(serializeDuel(session), source, reader),
    alliance,
    ownWarriorOne,
    ownWarriorTwo,
    ownChainStarter,
    opponentEarth,
    opponentFire,
    opponentSpecial,
  };
}

function cards(): DuelCardData[] {
  return [
    { code: allianceCode, name: "Ancient Warriors Saga - Sun-Liu Alliance", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setAncientWarriors] },
    { code: ownWarriorOneCode, name: "Ancient Warriors Ally Earth", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setAncientWarriors], race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: ownWarriorTwoCode, name: "Ancient Warriors Ally Fire", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setAncientWarriors], race: raceWarrior, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
    { code: ownChainStarterCode, name: "Ancient Warriors Chain Starter", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setAncientWarriors], race: raceWarrior, attribute: attributeEarth, level: 4, attack: 600, defense: 1000 },
    { code: opponentEarthCode, name: "Sun-Liu Opponent Earth", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    { code: opponentFireCode, name: "Sun-Liu Opponent Fire", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1800, defense: 1000 },
    { code: opponentSpecialCode, name: "Sun-Liu Opponent Special Starter", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1400, defense: 1000 },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ScriptSource {
  return {
    readScript(name: string) {
      if (name === `c${opponentSpecialCode}.lua`) return opponentSpecialStarterScript();
      return workspace.readScript(name);
    },
  };
}

function opponentSpecialStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_SPECIAL_SUMMON)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        local c=e:GetHandler()
        if c:IsRelateToEffect(e) then
          Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_ATTACK)
        end
      end)
      c:RegisterEffect(e)
    end
  `;
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

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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
  assertResponse(restored.session, response);
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

function assertResponse(session: DuelSession, response: ReturnType<typeof applyResponse>): void {
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
