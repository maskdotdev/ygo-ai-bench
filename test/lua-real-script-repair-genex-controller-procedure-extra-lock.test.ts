import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canPlayerSpecialSummon, createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { luaSummonTypeSynchro } from "#duel/summon-type-codes.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Repair Genex Controller procedure Extra Deck lock", () => {
  it("restores its Synchro-only Extra Deck lock that requires a summon procedure", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const repairGenexCode = "8173184";
    const synchroCode = "900000280";
    const fusionCode = "900000281";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === repairGenexCode),
      { code: synchroCode, name: "Repair Genex Synchro Procedure Probe", kind: "extra", typeFlags: 0x2001, race: 0x20, attribute: 0x10, level: 5, attack: 2000, defense: 1000 },
      { code: fusionCode, name: "Repair Genex Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x20, attribute: 0x10, level: 5, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 817, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [repairGenexCode], extra: [synchroCode, fusionCode] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const source = {
      readScript(name: string) {
        if (name === `c${synchroCode}.lua`) {
          return `
          c${synchroCode}={}
          function c${synchroCode}.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_FIELD)
            e:SetCode(EFFECT_SPSUMMON_PROC)
            e:SetRange(LOCATION_EXTRA)
            e:SetValue(SUMMON_TYPE_SYNCHRO)
            c:RegisterEffect(e)
          end
          `;
        }
        return workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(repairGenexCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(synchroCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const script = host.loadScript(
      `
      local source=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${repairGenexCode}),0,LOCATION_DECK,0,nil)
      local e1=Effect.CreateEffect(source)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)
      e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e1:SetTargetRange(1,0)
      e1:SetTarget(function(_e,_c,_tp,st,pos,target_p,sumeff,proc_eff) return _c:IsLocation(LOCATION_EXTRA) and (st&SUMMON_TYPE_SYNCHRO~=SUMMON_TYPE_SYNCHRO or proc_eff==nil) end)
      Duel.RegisterEffect(e1,0)
      `,
      "repair-genex-controller-procedure-extra-lock.lua",
    );
    expect(script.ok, script.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 22,
          luaTargetDescriptor: `target:extra-summon-type-not-or-no-procedure:${luaSummonTypeSynchro}`,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const synchro = restored.session.state.cards.find((card) => card.code === synchroCode);
    const procedureEffectId = Number(restored.session.state.effects.find((effect) => effect.sourceUid === synchro?.uid && effect.event === "summonProcedure")?.id.match(/^lua-(\d+)/)?.[1]);
    expect(Number.isFinite(procedureEffectId)).toBe(true);
    expect(canPlayerSpecialSummon(restored.session.state, 0, synchro, luaSummonTypeSynchro, procedureEffectId)).toBe(true);
    expect(canPlayerSpecialSummon(restored.session.state, 0, synchro, luaSummonTypeSynchro)).toBe(false);
    const rawProbe = restored.host.loadScript(
      `
      local synchro=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${synchroCode}),0,LOCATION_EXTRA,0,nil)
      local fusion=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fusionCode}),0,LOCATION_EXTRA,0,nil)
      Debug.Message("repair genex raw synchro special " .. Duel.SpecialSummon(synchro,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("repair genex fusion special " .. Duel.SpecialSummon(fusion,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "repair-genex-controller-raw-extra-lock-probe.lua",
    );
    expect(rawProbe.ok, rawProbe.error).toBe(true);
    expect(restored.host.messages).toEqual(expect.arrayContaining(["repair genex raw synchro special 0", "repair genex fusion special 0"]));
  });
});
