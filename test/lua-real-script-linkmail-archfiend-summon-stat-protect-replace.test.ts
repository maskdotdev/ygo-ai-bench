import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { ApplyDuelResponseResult, DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const linkmailCode = "68295149";
const hasLinkmailScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${linkmailCode}.lua`));
const summonerCode = "682951490";
const synchroTargetCode = "682951491";
const opponentACode = "682951492";
const opponentBCode = "682951493";
const replacementCode = "682951494";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeSynchro = 0x2000;
const typeLink = 0x4000000;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const effectDestroyReplace = 50;
const effectCannotBeEffectTarget = 71;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasLinkmailScript)("Lua real script Linkmail Archfiend summon stat protect replace", () => {
  it("restores Special Summon ATK reduction, Extra Deck targeting protection, and grave FRSX destroy replacement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${linkmailCode}.lua`);
    expect(script).toContain("Linkmail Archfiend");
    expect(script).toContain("Link.AddProcedure(c,nil,2,4,s.lcheck)");
    expect(script).toContain("return g:IsExists(Card.IsType,1,nil,TYPE_FRSX,lc,sumtype,tp)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return c:IsType(TYPE_FRSX) and c:GetAttack()>0");
    expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_GRAVE|LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(-atk)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
    expect(script).toContain("e2:SetTarget(aux.TargetBoolFunction(Card.IsSummonLocation,LOCATION_EXTRA))");
    expect(script).toContain("return re:IsMonsterEffect() and rp~=e:GetHandlerPlayer()");
    expect(script).toContain("e3:SetCode(EFFECT_DESTROY_REPLACE)");
    expect(script).toContain("Duel.SelectEffectYesNo(tp,c,96)");
    expect(script).toContain("e:SetLabelObject(g:GetFirst())");
    expect(script).toContain("Duel.Remove(tc,POS_FACEUP,REASON_EFFECT|REASON_REPLACE)");

    const cards: DuelCardData[] = [
      { code: linkmailCode, name: "Linkmail Archfiend", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceFiend, level: 4, attack: 2800, defense: 0, linkMarkers: 0x2b },
      { code: summonerCode, name: "Linkmail Fixture Summoner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, level: 4, attack: 1000, defense: 1000 },
      { code: synchroTargetCode, name: "Linkmail Synchro ATK Source", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWarrior, level: 8, attack: 2400, defense: 2000 },
      { code: opponentACode, name: "Linkmail Opponent A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 3000, defense: 1000 },
      { code: opponentBCode, name: "Linkmail Opponent B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1800, defense: 1000 },
      { code: replacementCode, name: "Linkmail Grave Fusion Replacement", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceFiend, level: 6, attack: 2100, defense: 1600 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 68295149, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [summonerCode], extra: [linkmailCode, synchroTargetCode, replacementCode] }, 1: { main: [opponentACode, opponentBCode] } });
    startDuel(session);

    const linkmail = requireCard(session, linkmailCode);
    const summoner = requireCard(session, summonerCode);
    const synchroTarget = requireCard(session, synchroTargetCode);
    const opponentA = requireCard(session, opponentACode);
    const opponentB = requireCard(session, opponentBCode);
    const replacement = requireCard(session, replacementCode);
    moveFaceUpAttack(session, summoner, 0, 0);
    moveDuelCard(session.state, synchroTarget.uid, "graveyard", 0);
    moveFaceUpAttack(session, opponentA, 1, 0);
    moveFaceUpAttack(session, opponentB, 1, 1);
    moveDuelCard(session.state, replacement.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${summonerCode}.lua`) return summonerScript(linkmailCode);
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [linkmailCode, summonerCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(2);

    const summon = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === summoner.uid);
    expect(summon, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, summon!);
    resolveChain(session);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === linkmail.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(findCard(restoredTrigger.session, opponentA.uid), restoredTrigger.session.state)).toBe(600);
    expect(currentAttack(findCard(restoredTrigger.session, opponentB.uid), restoredTrigger.session.state)).toBe(-600);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === linkmail.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      previousLocation: "extraDeck",
    });
    expect(restoredTrigger.session.state.effects.filter((effect) =>
      effect.sourceUid === linkmail.uid && [effectCannotBeEffectTarget, effectDestroyReplace].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotBeEffectTarget, event: "continuous", range: ["monsterZone"], targetRange: [4, 0], value: undefined },
      { code: effectDestroyReplace, event: "continuous", range: ["monsterZone"], targetRange: undefined, value: undefined },
    ]);
    expect(restoredTrigger.session.state.effects.filter((effect) =>
      effect.code === effectUpdateAttack && [opponentA.uid, opponentB.uid].includes(effect.sourceUid)
    ).map((effect) => ({
      code: effect.code,
      sourceUid: effect.sourceUid,
      value: effect.value,
    })).sort((left, right) => left.sourceUid.localeCompare(right.sourceUid))).toEqual([
      { code: effectUpdateAttack, sourceUid: opponentA.uid, value: -2400 },
      { code: effectUpdateAttack, sourceUid: opponentB.uid, value: -2400 },
    ].sort((left, right) => left.sourceUid.localeCompare(right.sourceUid)));

    const restoredReplacement = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredReplacement);
    expectRestoredLegalActions(restoredReplacement, 0);
    destroyDuelCard(restoredReplacement.session.state, linkmail.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredReplacement.host.promptDecisions).toContainEqual({
      id: "lua-prompt-1",
      api: "SelectEffectYesNo",
      player: 0,
      description: 96,
      returned: true,
    });
    expect(restoredReplacement.session.state.cards.find((card) => card.uid === linkmail.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    expect(restoredReplacement.session.state.effects.find((effect) =>
      effect.sourceUid === linkmail.uid && effect.code === effectDestroyReplace
    )?.labelObjectUid).toBe(synchroTarget.uid);
    expect(restoredReplacement.session.state.cards.find((card) => card.uid === synchroTarget.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect | duelReason.replace,
      reasonPlayer: 0,
      reasonCardUid: linkmail.uid,
    });
    expect(restoredReplacement.session.state.cards.find((card) => card.uid === replacement.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
    });
    expect(restoredReplacement.session.state.log).toContainEqual(expect.objectContaining({
      action: "destroyReplace",
      player: 0,
      card: linkmail.name,
      detail: "Destruction replaced",
    }));
    expect(restoredReplacement.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function summonerScript(linkmailCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.GetLocationCountFromEx(tp,tp,nil)>0
          and Duel.IsExistingMatchingCard(Card.IsCode,tp,LOCATION_EXTRA,0,1,nil,${linkmailCode}) end
        Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_EXTRA)
      end)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetMatchingGroup(Card.IsCode,tp,LOCATION_EXTRA,0,nil,${linkmailCode}):GetFirst()
        if tc then Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP) end
      end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): ApplyDuelResponseResult {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  return response;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveChain(session: DuelSession): void {
  let guard = 0;
  while (session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
