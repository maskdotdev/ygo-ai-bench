import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { duelActivity } from "#duel/activity.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import {
  applyLuaRestoreResponse,
  getLuaRestoreLegalActionGroups,
  getLuaRestoreLegalActions,
  restoreDuelWithLuaScripts,
} from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const fuwalosCode = "42141493";
const puruliaCode = "84192580";
const meowlsCode = "87126721";
const hasFuwalosScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${fuwalosCode}.lua`));
const hasPuruliaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${puruliaCode}.lua`));
const hasMeowlsScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${meowlsCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setMulcharmy = 0x1ac;

describe.skipIf(!hasUpstreamScripts || !hasFuwalosScript || !hasPuruliaScript || !hasMeowlsScript)("Lua real script Mulcharmy activity counters", () => {
  it("counts real Mulcharmy monster effect chain activations for the shared two-activation limit", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const codes = [fuwalosCode, puruliaCode, meowlsCode];
    expect(workspace.readScript(`c${fuwalosCode}.lua`)).toContain("Duel.AddCustomActivityCounter(id,ACTIVITY_CHAIN");
    expect(workspace.readScript(`c${puruliaCode}.lua`)).toContain("Duel.GetCustomActivityCount(id,tp,ACTIVITY_CHAIN)<2");
    expect(workspace.readScript(`c${meowlsCode}.lua`)).toContain("re:GetHandler():IsSetCard(SET_MULCHARMY) and re:IsMonsterEffect()");
    const cards = mulcharmyCards();
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 292, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: codes }, 1: { main: [] } });
    startDuel(session);

    for (const code of codes) {
      const card = session.state.cards.find((candidate) => candidate.code === code && candidate.location === "deck");
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }

    const host = createLuaScriptHost(session, workspace);
    for (const code of codes) expect(host.loadCardScript(Number(code), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const activateByCode = (code: string) => {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === card?.uid);
      expect(action).toBeDefined();
      const result = applyResponse(session, action!);
      expect(result.ok, result.error).toBe(true);
      return session.state.cards.find((candidate) => candidate.uid === card!.uid);
    };

    const fuwalos = activateByCode(fuwalosCode);
    expect(fuwalos).toMatchObject({ location: "graveyard" });

    const restoredAfterFuwalos = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredAfterFuwalos.restoreComplete, restoredAfterFuwalos.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restoredAfterFuwalos, 0)).toEqual(getGroupedDuelLegalActions(restoredAfterFuwalos.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredAfterFuwalos, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restoredAfterFuwalos, 0),
    );
    expect(restoredAfterFuwalos.session.state.activityHistory.filter((record) => record.activity === duelActivity.chain && record.player === 0)).toHaveLength(1);

    const purulia = restoredAfterFuwalos.session.state.cards.find((candidate) => candidate.code === puruliaCode);
    const puruliaAction = getLuaRestoreLegalActions(restoredAfterFuwalos, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === purulia?.uid);
    expect(puruliaAction).toBeDefined();
    const puruliaResult = applyLuaRestoreResponse(restoredAfterFuwalos, puruliaAction!);
    expect(puruliaResult.ok, puruliaResult.error).toBe(true);
    expect(restoredAfterFuwalos.session.state.cards.find((card) => card.uid === purulia!.uid)).toMatchObject({ location: "graveyard" });

    const meowls = restoredAfterFuwalos.session.state.cards.find((card) => card.code === meowlsCode);
    expect(getLuaRestoreLegalActions(restoredAfterFuwalos, 0).some((action) => action.type === "activateEffect" && action.uid === meowls?.uid)).toBe(false);
    const chainActivity = restoredAfterFuwalos.session.state.activityHistory.filter((record) => record.activity === duelActivity.chain && record.player === 0);
    expect(chainActivity).toHaveLength(2);
    expect(chainActivity.every((record) => record.effectId?.startsWith("lua-"))).toBe(true);

    const restoredAfterPurulia = restoreDuelWithLuaScripts(serializeDuel(restoredAfterFuwalos.session), workspace, reader);
    expect(restoredAfterPurulia.restoreComplete, restoredAfterPurulia.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterPurulia.missingRegistryKeys).toEqual([]);
    expect(restoredAfterPurulia.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredAfterPurulia, 0)).toEqual(getGroupedDuelLegalActions(restoredAfterPurulia.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredAfterPurulia, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restoredAfterPurulia, 0),
    );
    expect(restoredAfterPurulia.session.state.effects.some((effect) => effect.registryKey?.startsWith(`lua:${puruliaCode}:`) && effect.code === 1100)).toBe(true);
    expect(restoredAfterPurulia.session.state.effects.some((effect) => effect.registryKey?.startsWith(`lua:${puruliaCode}:`) && effect.code === 1102)).toBe(true);
    expect(restoredAfterPurulia.session.state.effects.some((effect) => effect.registryKey?.startsWith(`lua:${fuwalosCode}:`) && effect.code === 1102)).toBe(true);
    expect(getLuaRestoreLegalActions(restoredAfterPurulia, 0).some((action) => action.type === "activateEffect" && action.uid === meowls?.uid)).toBe(false);
  });

  it("delays restored Mulcharmy chain-solving draws until the current chain link is solved", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const summonerCode = "99042101";
    const summonedCode = "99042102";
    const drawCode = "99042103";
    expect(workspace.readScript(`c${fuwalosCode}.lua`)).toContain("Duel.IsChainSolving()");
    expect(workspace.readScript(`c${fuwalosCode}.lua`)).toContain("e1:SetCode(EVENT_CHAIN_SOLVED)");
    expect(workspace.readScript(`c${fuwalosCode}.lua`)).toContain("Duel.Draw(tp,e:GetLabel(),REASON_EFFECT)");
    const cards: DuelCardData[] = [
      ...mulcharmyCards([fuwalosCode]),
      { code: summonerCode, name: "Mulcharmy Chain Summoner", kind: "monster", typeFlags: 0x1 | 0x20, level: 4 },
      { code: summonedCode, name: "Mulcharmy Deck Summon Target", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: drawCode, name: "Mulcharmy Draw Card", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4214, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fuwalosCode, drawCode] }, 1: { main: [summonerCode, summonedCode] } });
    startDuel(session);

    const fuwalos = session.state.cards.find((card) => card.code === fuwalosCode);
    const summoner = session.state.cards.find((card) => card.code === summonerCode);
    const summoned = session.state.cards.find((card) => card.code === summonedCode);
    const drawCard = session.state.cards.find((card) => card.code === drawCode);
    expect(fuwalos).toBeDefined();
    expect(summoner).toBeDefined();
    expect(summoned).toBeDefined();
    expect(drawCard).toBeDefined();
    moveDuelCard(session.state, fuwalos!.uid, "hand", 0);
    moveDuelCard(session.state, summoner!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${summonerCode}.lua`) return chainSummonerScript(summonedCode);
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fuwalosCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(summonerCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const fuwalosAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === fuwalos!.uid);
    expect(fuwalosAction, JSON.stringify(getDuelLegalActions(session, 0), null, 2)).toBeDefined();
    expect(applyResponse(session, fuwalosAction!).ok).toBe(true);
    const restoredFuwalos = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredFuwalos.restoreComplete, restoredFuwalos.incompleteReasons.join("; ")).toBe(true);
    const fuwalosPlayer = restoredFuwalos.session.state.waitingFor ?? restoredFuwalos.session.state.turnPlayer;
    expect(getLuaRestoreLegalActionGroups(restoredFuwalos, fuwalosPlayer)).toEqual(getGroupedDuelLegalActions(restoredFuwalos.session, fuwalosPlayer));
    expect(getLuaRestoreLegalActionGroups(restoredFuwalos, fuwalosPlayer).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restoredFuwalos, fuwalosPlayer),
    );
    passRestoredChain(restoredFuwalos);

    const restoredSummoner = restoreDuelWithLuaScripts(serializeDuel(restoredFuwalos.session), source, reader);
    expect(restoredSummoner.restoreComplete, restoredSummoner.incompleteReasons.join("; ")).toBe(true);
    restoredSummoner.session.state.turnPlayer = 1;
    restoredSummoner.session.state.waitingFor = 1;
    expect(getLuaRestoreLegalActionGroups(restoredSummoner, 1)).toEqual(getGroupedDuelLegalActions(restoredSummoner.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredSummoner, 1).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restoredSummoner, 1),
    );
    const summonAction = getLuaRestoreLegalActions(restoredSummoner, 1).find((action) => action.type === "activateEffect" && action.uid === summoner!.uid);
    expect(summonAction, JSON.stringify(getLuaRestoreLegalActions(restoredSummoner, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummoner, summonAction!);
    passRestoredChain(restoredSummoner);

    expect(restoredSummoner.host.messages).toContain("chain summoner hand after summon 0");
    expect(restoredSummoner.session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "monsterZone", controller: 1, previousLocation: "deck" });
    expect(restoredSummoner.session.state.cards.find((card) => card.uid === drawCard!.uid)).toMatchObject({ location: "hand", controller: 0 });
  });
});

function mulcharmyCards(codes: string[] = [fuwalosCode, puruliaCode, meowlsCode]): DuelCardData[] {
  const cards: Record<string, DuelCardData> = {
    [fuwalosCode]: { code: fuwalosCode, name: "Mulcharmy Fuwalos", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMulcharmy], level: 4 },
    [puruliaCode]: { code: puruliaCode, name: "Mulcharmy Purulia", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMulcharmy], level: 4 },
    [meowlsCode]: { code: meowlsCode, name: "Mulcharmy Meowls", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMulcharmy], level: 4 },
  };
  return codes.map((code) => cards[code]).filter((card): card is DuelCardData => card !== undefined);
}

function chainSummonerScript(summonedCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(s.op)
      c:RegisterEffect(e)
    end
    function s.filter(c,e,tp)
      return c:IsCode(${summonedCode}) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)
    end
    function s.op(e,tp)
      local tc=Duel.GetFirstMatchingCard(s.filter,tp,LOCATION_DECK,0,nil,e,tp)
      if tc then Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_ATTACK) end
      Debug.Message("chain summoner hand after summon " .. Duel.GetFieldGroupCount(1-tp,LOCATION_HAND,0))
    end
  `;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = result.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  }
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
