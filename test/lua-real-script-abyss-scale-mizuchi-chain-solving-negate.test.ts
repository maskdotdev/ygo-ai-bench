import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const mizuchiCode = "72932673";
const hasMizuchiScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mizuchiCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEquip = 0x40000;
const typeContinuous = 0x20000;
const setMermail = 0x74;

describe.skipIf(!hasUpstreamScripts || !hasMizuchiScript)("Lua real script Abyss-scale Mizuchi chain-solving negate", () => {
  it("restores equipped EVENT_CHAIN_SOLVING Spell negation and sends the Equip Spell to Graveyard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mermailCode = "729326730";
    const opponentSpellCode = "729326731";
    const script = workspace.readScript(`c${mizuchiCode}.lua`);
    expect(script).toContain("aux.AddEquipProcedure(c,nil,aux.FilterBoolFunction(Card.IsSetCard,SET_MERMAIL))");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_EQUIP)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetValue(800)");
    expect(script).toContain("e4:SetCode(EVENT_CHAIN_SOLVING)");
    expect(script).toContain("re:IsSpellEffect() and Duel.IsChainDisablable(ev)");
    expect(script).toContain("Duel.NegateEffect(ev)");
    expect(script).toContain("Duel.SendtoGrave(e:GetHandler(),REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: mizuchiCode, name: "Abyss-scale of the Mizuchi", kind: "spell", typeFlags: typeSpell | typeEquip },
      { code: mermailCode, name: "Mizuchi Mermail Equipped Target", kind: "monster", typeFlags: typeMonster, setcodes: [setMermail], level: 4, attack: 1600, defense: 1200 },
      { code: opponentSpellCode, name: "Mizuchi Opponent S/T Spell Effect", kind: "spell", typeFlags: typeSpell | typeContinuous },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 72932673, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mizuchiCode, mermailCode] }, 1: { main: [opponentSpellCode] } });
    startDuel(session);

    const mizuchi = requireCard(session, mizuchiCode);
    const mermail = requireCard(session, mermailCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    const movedMermail = moveDuelCard(session.state, mermail.uid, "monsterZone", 0);
    movedMermail.faceUp = true;
    movedMermail.position = "faceUpAttack";
    const movedMizuchi = moveDuelCard(session.state, mizuchi.uid, "spellTrapZone", 0);
    movedMizuchi.faceUp = true;
    movedMizuchi.position = "faceUpAttack";
    movedMizuchi.equippedToUid = mermail.uid;
    mermail.cardTargetUids = [mizuchi.uid];
    const movedOpponentSpell = moveDuelCard(session.state, opponentSpell.uid, "spellTrapZone", 1);
    movedOpponentSpell.faceUp = true;
    movedOpponentSpell.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${opponentSpellCode}.lua`) return opponentSpellScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mizuchiCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === mermail.uid), restoredOpen.session.state)).toBe(2400);
    const spellAction = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === opponentSpell.uid);
    expect(spellAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, spellAction!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 0);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("mizuchi opponent spell resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === mizuchi.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === opponentSpell.uid)).toMatchObject({ location: "spellTrapZone", controller: 1 });
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === mermail.uid), restoredChain.session.state)).toBe(1600);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["chainSolving", "chainNegated", "chainDisabled", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "chainSolving",
        eventCode: 1020,
        eventCardUid: opponentSpell.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventReason: 0,
        eventReasonPlayer: 1,
        relatedEffectId: 5,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: mizuchi.uid,
        eventReason: 64,
        eventReasonPlayer: 0,
        eventReasonCardUid: mizuchi.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        relatedEffectId: 5,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        relatedEffectId: 5,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 1);
    expect(restoredAfter.session.state.cards.find((card) => card.uid === mizuchi.uid)).toMatchObject({ location: "graveyard", controller: 0 });
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
        Debug.Message("mizuchi opponent spell resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
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

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLegalActions(restored.session, waitingFor));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
