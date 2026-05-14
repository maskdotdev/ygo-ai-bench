import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeSpell = 0x2;
const raceSpellcaster = 0x2;
const setMagistus = 0x152;
const categorySpecialSummon = 0x200;
const locationHandGraveExtra = 0x52;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Magia Magic SelectEffect", () => {
  it("restores multi-option SelectEffect into Magia Magic's Special Summon branch", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const magiaCode = "59080";
    const magistusCostCode = "59081";
    const spellcasterCode = "59082";
    const banishTargetCode = "59083";
    const responderCode = "59084";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === magiaCode),
      { code: magistusCostCode, name: "Magia Magic Magistus Cost", kind: "monster", typeFlags: typeMonster, setcodes: [setMagistus], level: 4, attack: 1000, defense: 1000 },
      { code: spellcasterCode, name: "Magia Magic Spellcaster Target", kind: "monster", typeFlags: typeMonster, race: raceSpellcaster, level: 4, attack: 1500, defense: 1200 },
      { code: banishTargetCode, name: "Magia Magic Banish Target", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Magia Magic Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 59080, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [magiaCode, magistusCostCode, spellcasterCode, banishTargetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const magia = requireCard(session, magiaCode);
    const magistusCost = requireCard(session, magistusCostCode);
    const spellcaster = requireCard(session, spellcasterCode);
    const banishTarget = requireCard(session, banishTargetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, magia.uid, "hand", 0);
    moveDuelCard(session.state, magistusCost.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, spellcaster.uid, "graveyard", 0);
    moveDuelCard(session.state, banishTarget.uid, "spellTrapZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const { source, host } = loadMagiaMagicHost(session, workspace, magiaCode, responderCode);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === magia.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: magia.uid,
      effectLabel: 1,
      operationInfos: [{ category: categorySpecialSummon, count: 1, player: 0, parameter: locationHandGraveExtra }],
    });
    expect(host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        api: "SelectEffect",
        player: 0,
        options: [1, 2],
        returned: 1,
      }),
    ]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain[0]).toMatchObject({
      sourceUid: magia.uid,
      effectLabel: 1,
      operationInfos: [{ category: categorySpecialSummon, count: 1, player: 0, parameter: locationHandGraveExtra }],
    });

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === spellcaster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === magia.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === magistusCost.uid)).toMatchObject({
      location: "graveyard",
      reason: 0x80,
    });
    expect(restored.session.state.cards.find((card) => card.uid === banishTarget.uid)).toMatchObject({ location: "spellTrapZone" });
    expect(host.messages).not.toContain("magia magic responder resolved");
    expect(restored.host.messages).not.toContain("magia magic responder resolved");
  });
});

function loadMagiaMagicHost(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, magiaCode: string, responderCode: string) {
  const source = {
    readScript(name: string) {
      if (name === `c${responderCode}.lua`) return chainResponderScript();
      return workspace.readScript(name);
    },
  };
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(magiaCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return { source, host };
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("magia magic responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
