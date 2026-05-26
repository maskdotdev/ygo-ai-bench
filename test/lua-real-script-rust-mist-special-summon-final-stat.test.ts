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
const rustMistCode = "2148918";
const ninjaCode = "21489180";
const opponentSpecialCode = "21489181";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRustMistScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rustMistCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const setNinja = 0x2b;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasRustMistScript)("Lua real script Rust Mist special summon final stat", () => {
  it("restores mandatory opponent Special Summon trigger into final ATK halving", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rustMistCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());
    const session = createRustMistSession(reader, source, workspace);
    const rustMist = requireCard(session, rustMistCode);
    const ninja = requireCard(session, ninjaCode);
    const opponentSpecial = requireCard(session, opponentSpecialCode);

    moveFaceUpSpell(session, rustMist, 0, 0);
    moveFaceUpAttack(session, ninja, 0, 0);
    moveDuelCard(session.state, opponentSpecial.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const special = getLuaRestoreLegalActions(restoredOpen, 1).find((action) =>
      action.type === "activateEffect" && action.uid === opponentSpecial.uid
    );
    expect(special, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, special!);
    resolveRestoredChain(restoredOpen);

    expect(findCard(restoredOpen.session, opponentSpecial.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 1,
      reasonCardUid: opponentSpecial.uid,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: opponentSpecial.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: opponentSpecial.uid, eventReasonPlayer: 1 },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === rustMist.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(findCard(restoredTrigger.session, opponentSpecial.uid), restoredTrigger.session.state)).toBe(1200);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === opponentSpecial.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", reset: { flags: 33427456 }, sourceUid: opponentSpecial.uid, value: 1200 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

type ScriptSource = { readScript(name: string): string | undefined };

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Armor Ninjitsu Art of Rust Mist");
  expect(script).toContain("e1:SetTarget(s.target)");
  expect(script).toContain("Duel.CheckEvent(EVENT_SPSUMMON_SUCCESS,true)");
  expect(script).toContain("Duel.SelectYesNo(tp,94)");
  expect(script).toContain("Duel.SetTargetCard(eg)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()/2)");
}

function cards(): DuelCardData[] {
  return [
    { code: rustMistCode, name: "Armor Ninjitsu Art of Rust Mist", kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: ninjaCode, name: "Rust Mist Ninja", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setNinja], race: raceWarrior, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
    { code: opponentSpecialCode, name: "Rust Mist Opponent Special", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2400, defense: 1200 },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ScriptSource {
  return {
    readScript(name: string) {
      if (name === `c${opponentSpecialCode}.lua`) return opponentSpecialScript();
      return workspace.readScript(name);
    },
  };
}

function opponentSpecialScript(): string {
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

function createRustMistSession(reader: ReturnType<typeof createCardReader>, source: ScriptSource, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelSession {
  const session = createDuel({ seed: 2148918, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [rustMistCode, ninjaCode] }, 1: { main: [opponentSpecialCode] } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  for (const code of [rustMistCode, opponentSpecialCode]) {
    const loaded = host.loadCardScript(Number(code), source);
    expect(loaded.ok, loaded.error).toBe(true);
  }
  expect(host.registerInitialEffects()).toBe(2);
  return session;
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
