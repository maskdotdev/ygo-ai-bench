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
const oathCode = "99311109";
const opponentExtraMonsterCode = "993111090";
const handProbeCode = "993111091";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasOathScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${oathCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const categoryControl = 0x2000;
const eventFreeChain = 1002;
const effectCannotSpecialSummon = 22;
const effectFlagCardTarget = 0x10;
const effectFlagPlayerTarget = 0x800;
const effectFlagOath = 0x80000;
const effectFlagClientHint = 0x4000000;
const resetPhaseEnd = 1073742336;
const activitySpecialSummon = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasOathScript)("Lua real script Oath of Companionship extra control special lock", () => {
  it("restores Extra Deck monster control and the cost-created Special Summon oath", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${oathCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 99311109, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [oathCode, handProbeCode] }, 1: { main: [opponentExtraMonsterCode] } });
    startDuel(session);

    const oath = requireCard(session, oathCode);
    const opponentExtraMonster = requireCard(session, opponentExtraMonsterCode);
    const handProbe = requireCard(session, handProbeCode);
    moveDuelCard(session.state, oath.uid, "hand", 0);
    moveDuelCard(session.state, handProbe.uid, "hand", 0);
    moveFaceUpAttack(session, opponentExtraMonster, 1, 0);
    opponentExtraMonster.summonType = "fusion";
    opponentExtraMonster.previousLocation = "extraDeck";
    opponentExtraMonster.summonPlayer = 1;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${handProbeCode}.lua`) return handProbeScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(oathCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(handProbeCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.activityHistory.filter((record) => record.player === 0 && record.activity === activitySpecialSummon)).toEqual([]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === oath.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryControl, code: eventFreeChain, event: "ignition", id: `lua-1-${eventFreeChain}`, property: effectFlagCardTarget, range: ["hand", "spellTrapZone"], triggerEvent: undefined },
    ]);
    expectRestoredLegalActions(restored, 0);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === oath.uid && action.effectId === `lua-1-${eventFreeChain}`
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, oath.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(findCard(restored.session, opponentExtraMonster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: oath.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.effects.filter((effect) =>
      effect.sourceUid === oath.uid && (effect.code === effectCannotSpecialSummon || effect.description !== undefined)
    ).map((effect) => ({
      code: effect.code,
      description: effect.description,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: effectCannotSpecialSummon, description: undefined, event: "continuous", property: effectFlagPlayerTarget | effectFlagOath, reset: { flags: resetPhaseEnd }, sourceUid: oath.uid, targetRange: [1, 0] },
      { code: undefined, description: 1588977745, event: "ignition", property: effectFlagPlayerTarget | effectFlagClientHint, reset: { flags: resetPhaseEnd }, sourceUid: oath.uid, targetRange: [1, 0] },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === opponentExtraMonster.uid)).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: opponentExtraMonster.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: oath.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { controller: 0, location: "monsterZone", sequence: 0, position: "faceUpAttack", faceUp: true },
      },
    ]);

    const restoredLocked = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expectCleanRestore(restoredLocked);
    expectRestoredLegalActions(restoredLocked, 0);
    const blockedProbe = getLuaRestoreLegalActions(restoredLocked, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handProbe.uid
    );
    expect(blockedProbe, JSON.stringify(getLuaRestoreLegalActions(restoredLocked, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLocked, blockedProbe!);
    resolveRestoredChain(restoredLocked);
    expect(findCard(restoredLocked.session, handProbe.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredLocked.host.messages).not.toContain("oath hand probe resolved");
  });
});

function cards(): DuelCardData[] {
  return [
    { code: oathCode, name: "Oath of Companionship", kind: "spell", typeFlags: typeSpell },
    { code: opponentExtraMonsterCode, name: "Oath Extra Deck Control Target", kind: "monster", typeFlags: typeMonster | typeEffect | typeFusion, race: raceWarrior, attribute: attributeEarth, level: 6, attack: 2200, defense: 1800 },
    { code: handProbeCode, name: "Oath Hand Special Probe", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Oath of Companionship");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return c:IsSummonLocation(LOCATION_EXTRA)");
  expect(script).toContain("return not Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("return Duel.GetActivityCount(tp,ACTIVITY_SPSUMMON)==0");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_OATH)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e1:SetTargetRange(1,0)");
  expect(script).toContain("e2:SetTargetRange(1,0)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
}

function handProbeScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        if Duel.SpecialSummon(e:GetHandler(),0,tp,tp,false,false,POS_FACEUP)>0 then
          Debug.Message("oath hand probe resolved")
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
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
