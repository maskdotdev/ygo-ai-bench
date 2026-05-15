import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Inzektor Axe damage-phase activation lock", () => {
  it("restores its attack-announcement card activation lock until the Damage Step", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const axeCode = "87973893";
    const attackerCode = "87973894";
    const spellCode = "87973895";
    const responderCode = "87973896";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === axeCode),
      { code: attackerCode, name: "Inzektor Axe Fixture Attacker", kind: "monster", typeFlags: 0x21, level: 4, attack: 1500, defense: 1200, setcodes: [0x56] },
      { code: spellCode, name: "Inzektor Axe Opponent Spell", kind: "spell", typeFlags: 0x2 },
      { code: responderCode, name: "Inzektor Axe Monster Responder", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 879, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [axeCode, attackerCode] }, 1: { main: [spellCode, responderCode] } });
    startDuel(session);

    const axe = requireCard(session, axeCode);
    const attacker = requireCard(session, attackerCode);
    const spell = requireCard(session, spellCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, axe.uid, "hand", 0);
    moveDuelCard(session.state, attacker.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, spell.uid, "hand", 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${spellCode}.lua`) return opponentSpellScript();
        if (name === `c${responderCode}.lua`) return monsterResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(axeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(spellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipWindow.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquipWindow, 0);
    const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === axe.uid);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEquipWindow, equipAction!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChain, pass!);
    expect(restoredChain.session.state.cards.find((card) => card.uid === axe.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: attacker.uid,
      faceUp: true,
    });

    restoredChain.session.state.phase = "battle";
    restoredChain.session.state.waitingFor = 0;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredBattle.restoreComplete, restoredBattle.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBattle.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && !action.targetUid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);

    const restoredAttackWindow = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expect(restoredAttackWindow.restoreComplete, restoredAttackWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAttackWindow.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredAttackWindow, 1);
    expect(restoredAttackWindow.session.state.effects.find((effect) => effect.sourceUid === axe.uid && effect.code === 6)).toMatchObject({
      event: "continuous",
      targetRange: [1, 1],
      luaValueDescriptor: "cannot-activate:card-activation",
      reset: { flags: 0x40000020 },
    });
    expect(getLuaRestoreLegalActions(restoredAttackWindow, 1).some((action) => action.type === "activateEffect" && action.uid === spell.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredAttackWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
  });
});

function opponentSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("inzektor axe opponent spell resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function monsterResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("inzektor axe monster responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, waitingFor));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
