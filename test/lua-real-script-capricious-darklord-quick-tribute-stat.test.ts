import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const capriciousCode = "55289183";
const tributeSummonCode = "552891830";
const fieldFairyCode = "552891831";
const opponentMonsterCode = "552891832";
const sendSpellCode = "552891833";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCapriciousScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${capriciousCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceFairy = 0x4;
const raceWarrior = 0x1;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasCapriciousScript)("Lua real script Capricious Darklord quick Tribute Summon stat", () => {
  it("restores Main Phase Quick Effect Tribute Summon legality and metadata", () => {
    const { workspace, source, reader, session } = createCapriciousSession(55289183);
    const capricious = requireCard(session, capriciousCode);
    const tributeSummon = requireCard(session, tributeSummonCode);
    moveFaceUpAttack(session, capricious, 0, 0);
    moveDuelCard(session.state, tributeSummon.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(capriciousCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === capricious.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      id: effect.id,
      registryKey: effect.registryKey,
    }))).toEqual([
      { code: 1002, event: "quick", id: "lua-1-1002", registryKey: `lua:${capriciousCode}:lua-1-1002` },
      { code: 1014, event: "trigger", id: "lua-2-1014", registryKey: `lua:${capriciousCode}:lua-2-1014` },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const quickSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === capricious.uid);
    expect(quickSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(quickSummon).toMatchObject({
      type: "activateEffect",
      uid: capricious.uid,
      effectId: "lua-1-1002",
      player: 0,
      windowKind: "open",
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === tributeSummon.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === capricious.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores EVENT_TO_GRAVE Fairy count into opponent ATK/DEF loss", () => {
    const { workspace, source, reader, session } = createCapriciousSession(55289184);
    const capricious = requireCard(session, capriciousCode);
    const fieldFairy = requireCard(session, fieldFairyCode);
    const opponent = requireCard(session, opponentMonsterCode);
    const sendSpell = requireCard(session, sendSpellCode);
    moveFaceUpAttack(session, capricious, 0, 0);
    moveFaceUpAttack(session, fieldFairy, 0, 1);
    moveFaceUpAttack(session, opponent, 1, 0);
    moveDuelCard(session.state, sendSpell.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(capriciousCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(sendSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const send = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === sendSpell.uid);
    expect(send, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, send!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === capricious.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: sendSpell.uid,
      reasonEffectId: 3,
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const statTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === capricious.uid && action.effectId === "lua-2-1014"
    );
    expect(statTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, statTrigger!);
    passRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponent.uid), restoredTrigger.session.state)).toBe(2000);
    expect(currentDefense(restoredTrigger.session.state.cards.find((card) => card.uid === opponent.uid), restoredTrigger.session.state)).toBe(1800);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: capricious.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: sendSpell.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: sendSpell.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "spellTrapZone", current: "graveyard" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createCapriciousSession(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${capriciousCode}.lua`));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [capriciousCode, tributeSummonCode, fieldFairyCode, sendSpellCode] },
    1: { main: [opponentMonsterCode] },
  });
  startDuel(session);
  const source = {
    readScript(name: string) {
      if (name === `c${sendSpellCode}.lua`) return sendCapriciousScript();
      return workspace.readScript(name);
    },
  };
  return { workspace, source, reader, session };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Capricious Darklord");
  expect(script).toContain("e1:SetCategory(CATEGORY_SUMMON)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("return Duel.IsMainPhase()");
  expect(script).toContain("return c:IsRace(RACE_FAIRY) and c:IsSummonable(true,nil,1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SUMMON,nil,1,0,0)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.sumfilter,tp,LOCATION_HAND,0,1,1,nil)");
  expect(script).toContain("Duel.Summon(tp,tc,true,nil,1)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsRace,RACE_FAIRY),tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
}

function cards(): DuelCardData[] {
  return [
    { code: capriciousCode, name: "Capricious Darklord", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeDark, level: 4, attack: 0, defense: 1600 },
    { code: tributeSummonCode, name: "Capricious Fixture Tribute Fairy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeDark, level: 5, attack: 2100, defense: 1400 },
    { code: fieldFairyCode, name: "Capricious Fixture Field Fairy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: opponentMonsterCode, name: "Capricious Fixture Opponent Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 2500, defense: 2300 },
    { code: sendSpellCode, name: "Capricious Fixture Send Spell", kind: "spell", typeFlags: typeSpell },
  ];
}

function sendCapriciousScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(s.target)
      e:SetOperation(s.operation)
      c:RegisterEffect(e)
    end
    function s.filter(c)
      return c:IsFaceup() and c:IsCode(${capriciousCode})
    end
    function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
      if chkc then return chkc:IsLocation(LOCATION_MZONE) and chkc:IsControler(tp) and s.filter(chkc) end
      if chk==0 then return Duel.IsExistingTarget(s.filter,tp,LOCATION_MZONE,0,1,nil) end
      Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TOGRAVE)
      local g=Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)
      Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,g,1,0,0)
    end
    function s.operation(e,tp)
      local tc=Duel.GetFirstTarget()
      if tc and tc:IsRelateToEffect(e) then Duel.SendtoGrave(tc,REASON_EFFECT) end
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
