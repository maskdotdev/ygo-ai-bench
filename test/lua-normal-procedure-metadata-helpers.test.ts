import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  moveDuelCard,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua normal procedure metadata helpers", () => {
  it("registers Lua normal summon and set procedure effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Procedure Source", kind: "monster", level: 7 },
      { code: "200", name: "Procedure Tribute A", kind: "monster", level: 4 },
      { code: "300", name: "Procedure Tribute B", kind: "monster", level: 4 },
      { code: "400", name: "Procedure Extra Tribute", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 57, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["200", "300", "400"]) {
      const tribute = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code);
      expect(tribute).toBeDefined();
      moveDuelCard(session.state, tribute!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local ns=aux.AddNormalSummonProcedure(c,true,true,1,1,SUMMON_TYPE_TRIBUTE,1234)
      local ls=aux.AddNormalSummonProcedure(c,false,false,2,2)
      local st=aux.AddNormalSetProcedure(c,true,true,1,1,SUMMON_TYPE_TRIBUTE,5678)
      local lt=aux.AddNormalSetProcedure(c,false,false,2,2)
      local rush=aux.summonproc(c,true,true,1,1,SUMMON_TYPE_TRIBUTE+100,9012)
      local rush3=aux.summonproc3trib(c,3456,aux.TRUE)
      local grant_target=aux.ThreeTribGrantTarget(function(e,tc) return tc:IsCode(100) end)
      Debug.Message("normal proc codes " .. ns:GetCode() .. "/" .. ls:GetCode() .. "/" .. st:GetCode() .. "/" .. lt:GetCode())
      Debug.Message("normal proc metadata " .. ns:GetDescription() .. "/" .. st:GetDescription() .. "/" .. ns:GetProperty() .. "/" .. ns:GetValue())
      Debug.Message("normal proc callbacks " .. tostring(ns:GetCondition()(ns,c,0,0,0,nil)) .. "/" .. tostring(ls:GetCondition()(ls,nil,0,0,0,nil)) .. "/" .. tostring(ns:GetTarget()~=nil) .. "/" .. tostring(ns:GetOperation()~=nil))
      Debug.Message("rush proc metadata " .. rush:GetCode() .. "/" .. rush:GetDescription() .. "/" .. rush:GetValue() .. "/" .. rush3:GetCode() .. "/" .. rush3:GetDescription() .. "/" .. rush3:GetValue())
      Debug.Message("rush proc registered " .. tostring(c:GetCardEffect(EFFECT_SUMMON_PROC)~=nil))
      Debug.Message("three tribute condition " .. tostring(rush3:GetCondition()(rush3,c)) .. "/" .. tostring(rush3:GetCondition()(rush3,nil)))
      Debug.Message("three tribute grant before " .. tostring(grant_target(rush3,c)))
      c:RegisterFlagEffect(FLAG_TRIPLE_TRIBUTE,RESET_EVENT,0,1)
      Debug.Message("three tribute grant after " .. FLAG_TRIPLE_TRIBUTE .. "/" .. tostring(grant_target(rush3,c)))
      Debug.Message("three tribute target " .. tostring(rush3:GetTarget()(rush3,0,nil,0,0,nil,0,0,1,c)))
      local g=rush3:GetLabelObject()
      Debug.Message("three tribute selected " .. g:GetCount())
      rush3:GetOperation()(rush3,0,nil,0,0,nil,0,0,c)
      Debug.Message("three tribute released " .. g:GetCount() .. "/" .. Duel.GetMatchingGroupCount(aux.TRUE,0,LOCATION_GRAVE,0,nil))
      `,
      "normal-procedure.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("normal proc codes 32/33/36/37");
    expect(host.messages).toContain("normal proc metadata 1234/5678/263168/285212672");
    expect(host.messages).toContain("normal proc callbacks true/true/true/true");
    expect(host.messages).toContain("rush proc metadata 32/9012/285212772/32/3456/285212673");
    expect(host.messages).toContain("rush proc registered true");
    expect(host.messages).toContain("three tribute condition true/true");
    expect(host.messages).toContain("three tribute grant before false");
    expect(host.messages).toContain("three tribute grant after 160012000/true");
    expect(host.messages).toContain("three tribute target true");
    expect(host.messages).toContain("three tribute selected 3");
    expect(host.messages).toContain("three tribute released 3/3");
  });

  it("applies Lua normal summon tribute metadata to legal actions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Three Tribute Target", kind: "monster", level: 7 },
      { code: "200", name: "Lua Material A", kind: "monster", level: 4 },
      { code: "300", name: "Lua Material B", kind: "monster", level: 4 },
      { code: "400", name: "Lua Material C", kind: "monster", level: 4 },
      { code: "500", name: "Lua Material D", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 257, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["200", "300", "400", "500"]) {
      const material = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code);
      expect(material).toBeDefined();
      moveDuelCard(session.state, material!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        aux.AddNormalSummonProcedure(c,true,false,3,3,SUMMON_TYPE_TRIBUTE+1,1111)
      end
      `,
      "three-tribute-metadata.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(target).toBeDefined();
    const actions = getDuelLegalActions(session, 0);
    expect(actions.some((action) => action.type === "tributeSummon" && action.uid === target!.uid && action.tributeUids.length === 2)).toBe(false);
    const summon = actions.find((action) => action.type === "tributeSummon" && action.uid === target!.uid && action.tributeUids.length === 3);
    expect(summon).toBeDefined();

    const response = applyResponse(session, summon!);
    expect(response.ok, response.error).toBe(true);
    const summoned = session.state.cards.find((card) => card.uid === target!.uid);
    expect(summoned?.location).toBe("monsterZone");
    expect(summoned?.summonTypeCode).toBe(0x11000001);
    expect(host.loadScript(`Debug.Message("three tribute summon type " .. Duel.GetFieldCard(0,LOCATION_MZONE,0):GetSummonType())`, "three-tribute-summon-type.lua").ok).toBe(true);
    expect(host.messages).toContain("three tribute summon type 285212673");
    if (!summon || summon.type !== "tributeSummon") throw new Error("Expected three-tribute summon action");
    for (const uid of summon.tributeUids) {
      expect(session.state.cards.find((card) => card.uid === uid)?.location).toBe("graveyard");
    }
    expect(session.state.log.at(-1)?.detail).toBe("Tribute Summoned with 3 tribute(s)");
  });

  it("applies Lua reduced normal summon tribute ranges to legal actions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lua Reduced Tribute Target", kind: "monster", level: 7 },
      { code: "200", name: "Lua Reduced Material A", kind: "monster", level: 4 },
      { code: "300", name: "Lua Reduced Material B", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 258, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["200", "300"]) {
      const material = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code);
      expect(material).toBeDefined();
      moveDuelCard(session.state, material!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        aux.AddNormalSummonProcedure(c,true,false,1,2,SUMMON_TYPE_TRIBUTE+1,2222)
      end
      `,
      "reduced-tribute-metadata.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(target).toBeDefined();
    const actions = getDuelLegalActions(session, 0).filter((action) => action.type === "tributeSummon" && action.uid === target!.uid);
    expect(actions.some((action) => action.type === "tributeSummon" && action.tributeUids.length === 1)).toBe(true);
    expect(actions.some((action) => action.type === "tributeSummon" && action.tributeUids.length === 2)).toBe(true);

    const summon = actions.find((action) => action.type === "tributeSummon" && action.tributeUids.length === 1);
    expect(summon).toBeDefined();
    const response = applyResponse(session, summon!);
    expect(response.ok, response.error).toBe(true);
    expect(session.state.log.at(-1)?.detail).toBe("Tribute Summoned with 1 tribute(s)");
  });

  it("executes Lua normal summon procedure tribute operations", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Procedure Tribute Target", kind: "monster", level: 6 },
      { code: "200", name: "Procedure Material A", kind: "monster", level: 4 },
      { code: "300", name: "Procedure Material B", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 157, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["200", "300"]) {
      const material = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code);
      expect(material).toBeDefined();
      moveDuelCard(session.state, material!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e=aux.AddNormalSummonProcedure(c,true,true,1,1,SUMMON_TYPE_TRIBUTE,1111)
      Debug.Message("normal proc target check " .. tostring(e:GetTarget()(e,0,nil,0,0,nil,0,0,0,c,0,0,0,nil)))
      Debug.Message("normal proc target select " .. tostring(e:GetTarget()(e,0,nil,0,0,nil,0,0,1,c,0,0,0,nil)))
      local g=e:GetLabelObject()
      Debug.Message("normal proc selected " .. g:GetCount() .. "/" .. g:GetFirst():GetCode())
      e:GetOperation()(e,0,nil,0,0,nil,0,0,c,0,0,0,nil)
      Debug.Message("normal proc released " .. c:GetMaterialCount() .. "/" .. Duel.GetMatchingGroupCount(aux.TRUE,0,LOCATION_GRAVE,0,nil) .. "/" .. tostring(e:GetLabelObject()==nil))
      `,
      "normal-procedure-operation.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("normal proc target check true");
    expect(host.messages).toContain("normal proc target select true");
    expect(host.messages).toContain("normal proc selected 1/200");
    expect(host.messages).toContain("normal proc released 1/1/true");
  });

  it("checks Lua normal summon procedure tribute availability in conditions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Procedure Condition Target", kind: "monster", level: 7 },
      { code: "200", name: "Procedure Condition Material", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 159, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e=aux.AddNormalSummonProcedure(c,true,true,1,1,SUMMON_TYPE_TRIBUTE,3333)
      Debug.Message("normal proc condition empty " .. tostring(e:GetCondition()(e,c,0,0,0,nil)))
      local material=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.MoveToField(material,0,0,LOCATION_MZONE,POS_FACEUP_ATTACK,true)
      Debug.Message("normal proc condition ready " .. tostring(e:GetCondition()(e,c,0,0,0,nil)))
      Debug.Message("normal proc condition relzone blocked " .. tostring(e:GetCondition()(e,c,0,0,0x2,nil)))
      Debug.Message("normal proc condition relzone ready " .. tostring(e:GetCondition()(e,c,0,0,0x1,nil)))
      `,
      "normal-procedure-condition.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("normal proc condition empty false");
    expect(host.messages).toContain("normal proc condition ready true");
    expect(host.messages).toContain("normal proc condition relzone blocked false");
    expect(host.messages).toContain("normal proc condition relzone ready true");
  });

  it("executes Lua normal set procedure tribute operations", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Procedure Set Target", kind: "monster", level: 6 },
      { code: "200", name: "Procedure Set Material", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 158, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const material = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(material).toBeDefined();
    moveDuelCard(session.state, material!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e=aux.AddNormalSetProcedure(c,true,true,1,1,SUMMON_TYPE_TRIBUTE,2222)
      Debug.Message("normal set proc relzone blocked " .. tostring(e:GetTarget()(e,0,nil,0,0,nil,0,0,0,c,0,0,0x2,nil)))
      Debug.Message("normal set proc target check " .. tostring(e:GetTarget()(e,0,nil,0,0,nil,0,0,0,c,0,0,0x1,nil)))
      Debug.Message("normal set proc target select " .. tostring(e:GetTarget()(e,0,nil,0,0,nil,0,0,1,c,0,0,0x1,nil)))
      local g=e:GetLabelObject()
      Debug.Message("normal set proc selected " .. g:GetCount() .. "/" .. g:GetFirst():GetCode())
      e:GetOperation()(e,0,nil,0,0,nil,0,0,c,0,0,0,nil)
      Debug.Message("normal set proc released " .. c:GetMaterialCount() .. "/" .. Duel.GetMatchingGroupCount(aux.TRUE,0,LOCATION_GRAVE,0,nil) .. "/" .. tostring(e:GetLabelObject()==nil))
      `,
      "normal-set-procedure-operation.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("normal set proc relzone blocked false");
    expect(host.messages).toContain("normal set proc target check true");
    expect(host.messages).toContain("normal set proc target select true");
    expect(host.messages).toContain("normal set proc selected 1/200");
    expect(host.messages).toContain("normal set proc released 1/1/true");
  });

});
