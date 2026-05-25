import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const whispersCode = "62530723";
const hasWhispersScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${whispersCode}.lua`));
const mekkKnightCode = "625307230";
const targetCode = "625307231";
const opponentSpellCode = "625307232";
const opponentMonsterCode = "625307233";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const setMekkKnight = 0x10c;

describe.skipIf(!hasUpstreamScripts || !hasWhispersScript)("Lua real script World Legacy Whispers column stat negate", () => {
  it("restores optional activation stat target and same-column opponent Spell negation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${whispersCode}.lua`);
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,0))");
    expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVING)");
    expect(script).toContain("re:IsSpellEffect()");
    expect(script).toContain("Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_CONTROLER,CHAININFO_TRIGGERING_LOCATION,CHAININFO_TRIGGERING_SEQUENCE)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_MZONE,0,1,nil,seq,p)");
    expect(script).toContain("Duel.NegateEffect(ev)");

    const cards: DuelCardData[] = [
      { code: whispersCode, name: "World Legacy Whispers", kind: "trap", typeFlags: typeTrap | typeContinuous },
      { code: mekkKnightCode, name: "Whispers Mekk-Knight Column", kind: "monster", typeFlags: typeMonster, setcodes: [setMekkKnight], level: 5, attack: 2000, defense: 1600 },
      { code: targetCode, name: "Whispers Level Target", kind: "monster", typeFlags: typeMonster, level: 6, attack: 1800, defense: 1200 },
      { code: opponentSpellCode, name: "Whispers Opponent Spell", kind: "spell", typeFlags: typeSpell | typeContinuous },
      { code: opponentMonsterCode, name: "Whispers Opponent Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2200, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 62530723, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [whispersCode, mekkKnightCode, targetCode] }, 1: { main: [opponentSpellCode, opponentMonsterCode] } });
    startDuel(session);

    const whispers = requireCard(session, whispersCode);
    const mekkKnight = requireCard(session, mekkKnightCode);
    const target = requireCard(session, targetCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    const movedWhispers = moveDuelCard(session.state, whispers.uid, "spellTrapZone", 0);
    movedWhispers.faceUp = false;
    movedWhispers.position = "faceDown";
    const movedMekk = moveDuelCard(session.state, mekkKnight.uid, "monsterZone", 0);
    movedMekk.faceUp = true;
    movedMekk.position = "faceUpAttack";
    movedMekk.sequence = 2;
    const movedTarget = moveDuelCard(session.state, target.uid, "monsterZone", 0);
    movedTarget.faceUp = true;
    movedTarget.position = "faceUpAttack";
    movedTarget.sequence = 1;
    const movedSpell = moveDuelCard(session.state, opponentSpell.uid, "spellTrapZone", 1);
    movedSpell.faceUp = true;
    movedSpell.position = "faceUpAttack";
    movedSpell.sequence = 2;
    const movedOpponentMonster = moveDuelCard(session.state, opponentMonster.uid, "monsterZone", 1);
    movedOpponentMonster.faceUp = true;
    movedOpponentMonster.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${opponentSpellCode}.lua`) return opponentSpellScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expect(host.loadCardScript(Number(whispersCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activateWhispers = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === whispers.uid);
    expect(activateWhispers, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activateWhispers!);
    expect(restoredOpen.host.promptDecisions).toEqual([{ id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 1000491568, returned: true }]);

    const restoredResolve = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expectCleanRestore(restoredResolve);
    expectRestoredLegalActions(restoredResolve, 1);
    passRestoredChain(restoredResolve);
    expect(restoredResolve.session.state.cards.find((card) => card.uid === whispers.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true });
    expect(currentAttack(restoredResolve.session.state.cards.find((card) => card.uid === target.uid), restoredResolve.session.state)).toBe(2800);
    expect(currentDefense(restoredResolve.session.state.cards.find((card) => card.uid === target.uid), restoredResolve.session.state)).toBe(2200);
    expect(restoredResolve.session.state.effects.filter((effect) => effect.sourceUid === target.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", reset: { flags: 1107169792 }, value: 1000 },
      { code: 104, event: "continuous", reset: { flags: 1107169792 }, value: 1000 },
    ]);
    restoredResolve.session.state.phase = "battle";
    restoredResolve.session.state.waitingFor = 0;
    const attack = getLegalActions(restoredResolve.session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === target.uid && action.targetUid === opponentMonster.uid);
    expect(attack, JSON.stringify(getLegalActions(restoredResolve.session, 0), null, 2)).toBeDefined();
    const attackResponse = applyResponse(restoredResolve.session, attack!);
    expect(attackResponse.ok, attackResponse.error).toBe(true);
    passBattleResponses(restoredResolve.session);
    expect(restoredResolve.session.state.battleDamage).toEqual({ 0: 0, 1: 600 });
    expect(restoredResolve.session.state.players[1].lifePoints).toBe(7400);
    expect(restoredResolve.session.state.cards.find((card) => card.uid === opponentMonster.uid)).toMatchObject({ location: "graveyard" });

    restoredResolve.session.state.turnPlayer = 1;
    restoredResolve.session.state.waitingFor = 1;
    restoredResolve.session.state.phase = "main1";
    const restoredSpellOpen = restoreDuelWithLuaScripts(serializeDuel(restoredResolve.session), source, reader);
    expectCleanRestore(restoredSpellOpen);
    expectRestoredLegalActions(restoredSpellOpen, 1);
    const spellAction = getLuaRestoreLegalActions(restoredSpellOpen, 1).find((action) => action.type === "activateEffect" && action.uid === opponentSpell.uid);
    expect(spellAction, JSON.stringify(getLuaRestoreLegalActions(restoredSpellOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSpellOpen, spellAction!);

    const restoredNegate = restoreDuelWithLuaScripts(serializeDuel(restoredSpellOpen.session), source, reader);
    expectCleanRestore(restoredNegate);
    expectRestoredLegalActions(restoredNegate, 0);
    passRestoredChain(restoredNegate);
    expect(restoredNegate.host.messages).not.toContain("world legacy whispers opponent spell resolved");
    expect(restoredNegate.session.state.cards.find((card) => card.uid === opponentSpell.uid)).toMatchObject({ location: "spellTrapZone", controller: 1 });
    expect(restoredNegate.session.state.eventHistory.filter((event) => ["chainSolving", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "chainSolving",
        eventCode: 1020,
        eventCardUid: whispers.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "chainSolving",
        eventCode: 1020,
        eventCardUid: opponentSpell.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventReason: 0,
        eventReasonPlayer: 1,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-8",
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 2 },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-8",
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-8",
      },
    ]);
    expect(restoredNegate.session.state.cards.find((card) => card.uid === whispers.uid)).toMatchObject({
      location: "spellTrapZone",
      reasonPlayer: 0,
    });
    expect(restoredNegate.session.state.battleDamage).toEqual({ 0: 0, 1: 600 });
  });
});

function opponentSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_SZONE)
      e:SetOperation(function(e,tp)
        Debug.Message("world legacy whispers opponent spell resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
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

function passBattleResponses(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    const response = applyResponse(session, pass!);
    expect(response.ok, response.error).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
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
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
