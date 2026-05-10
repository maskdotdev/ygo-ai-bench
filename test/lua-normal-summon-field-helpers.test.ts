import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua normal summon field helpers", () => {
  it("lets Lua scripts normal summon and set monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Normal Summon Source", kind: "monster", level: 4 },
      { code: "200", name: "Count Blocked Source", kind: "monster", level: 4 },
      { code: "300", name: "Set Source", kind: "monster", level: 4 },
      { code: "400", name: "Zone Blocked Source", kind: "monster", level: 4 },
      { code: "500", name: "Zone Filler A", kind: "monster" },
      { code: "600", name: "Zone Filler B", kind: "monster" },
      { code: "700", name: "Zone Filler C", kind: "monster" },
      { code: "800", name: "Zone Filler D", kind: "monster" },
      { code: "900", name: "Zone Filler E", kind: "monster" },
    ];
    const summonSession = createDuel({ seed: 88, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(summonSession, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(summonSession);

    const summonHost = createLuaScriptHost(summonSession);
    const summonResult = summonHost.loadScript(
      `
      local first = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local second = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("summon count before " .. tostring(Duel.CheckSummonedCount()))
      Debug.Message("summon result " .. Duel.Summon(first, true, nil))
      Debug.Message("summon count after " .. tostring(Duel.CheckSummonedCount()))
      Debug.Message("summon operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("summon ignore-count result " .. Duel.Summon(second, true, nil))
      Debug.Message("summon ignore-count operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("summon nil result " .. Duel.Summon(nil, true, nil))
      Debug.Message("summon nil operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "basic-normal-summon.lua",
    );
    expect(summonResult.ok, summonResult.error).toBe(true);
    expect(summonHost.messages).toContain("summon count before true");
    expect(summonHost.messages).toContain("summon result 1");
    expect(summonHost.messages).toContain("summon count after false");
    expect(summonHost.messages).toContain("summon operated 1/100");
    expect(summonHost.messages).toContain("summon ignore-count result 1");
    expect(summonHost.messages).toContain("summon ignore-count operated 1/200");
    expect(summonHost.messages).toContain("summon nil result 0");
    expect(summonHost.messages).toContain("summon nil operated 0");
    const summoned = summonSession.state.cards.find((card) => card.code === "100");
    expect(summoned).toMatchObject({ location: "monsterZone", position: "faceUpAttack", summonType: "normal" });
    const ignoreCountSummoned = summonSession.state.cards.find((card) => card.code === "200");
    expect(ignoreCountSummoned).toMatchObject({ location: "monsterZone", position: "faceUpAttack", summonType: "normal" });

    const countSession = createDuel({ seed: 93, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(countSession, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(countSession);
    const countHost = createLuaScriptHost(countSession);
    const countResult = countHost.loadScript(
      `
      Debug.Message("manual count before " .. tostring(Duel.CheckSummonedCount()))
      Duel.IncreaseSummonedCount()
      Debug.Message("manual count after " .. tostring(Duel.CheckSummonedCount()))
      Debug.Message("manual activity " .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SUMMON))
      `,
      "manual-summoned-count.lua",
    );
    expect(countResult.ok, countResult.error).toBe(true);
    expect(countHost.messages).toContain("manual count before true");
    expect(countHost.messages).toContain("manual count after false");
    expect(countHost.messages).toContain("manual activity 1/1");

    const setSession = createDuel({ seed: 89, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(setSession, {
      0: { main: ["300"] },
      1: { main: [] },
    });
    startDuel(setSession);
    const setHost = createLuaScriptHost(setSession);
    const setResult = setHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("mset result " .. Duel.MSet(target, true, nil))
      Debug.Message("mset operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("mset activity " .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SUMMON))
      Debug.Message("mset empty result " .. Duel.MSet(Group.CreateGroup(), true, nil))
      Debug.Message("mset empty operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "basic-monster-set.lua",
    );
    expect(setResult.ok, setResult.error).toBe(true);
    expect(setHost.messages).toContain("mset result 1");
    expect(setHost.messages).toContain("mset operated 1/300");
    expect(setHost.messages).toContain("mset activity 1/0");
    expect(setHost.messages).toContain("mset empty result 0");
    expect(setHost.messages).toContain("mset empty operated 0");
    const setMonster = setSession.state.cards.find((card) => card.code === "300");
    expect(setMonster).toMatchObject({ location: "monsterZone", position: "faceDownDefense", faceUp: false });

    const tributeSetSession = createDuel({ seed: 91, startingHandSize: 2, cardReader: createCardReader([...cards, { code: "950", name: "Tribute Set Source", kind: "monster", level: 5 }]) });
    loadDecks(tributeSetSession, {
      0: { main: ["950", "500"] },
      1: { main: [] },
    });
    startDuel(tributeSetSession);
    const tributeMaterial = tributeSetSession.state.cards.find((card) => card.code === "500");
    expect(tributeMaterial).toBeTruthy();
    moveDuelCard(tributeSetSession.state, tributeMaterial!.uid, "monsterZone", 0);
    registerEffect(tributeSetSession, {
      id: "tribute-set-material-sent",
      sourceUid: tributeMaterial!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "sentToGraveyard",
      range: ["graveyard"],
      operation(ctx) {
        ctx.log(`Tribute set material trigger ${ctx.eventCard?.code ?? ""}`);
      },
    });
    const tributeSetHost = createLuaScriptHost(tributeSetSession);
    const tributeSetResult = tributeSetHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 950), 0, LOCATION_HAND, 0, 1, 1, nil)
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("tribute mset result " .. Duel.MSet(target, true, tribute))
      Debug.Message("tribute mset operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("tribute mset activity " .. Duel.GetActivityCount(0, ACTIVITY_NORMALSUMMON) .. "/" .. Duel.GetActivityCount(0, ACTIVITY_SUMMON))
      `,
      "tribute-monster-set.lua",
    );
    expect(tributeSetResult.ok, tributeSetResult.error).toBe(true);
    expect(tributeSetHost.messages).toContain("tribute mset result 1");
    expect(tributeSetHost.messages).toContain("tribute mset operated 1/950");
    expect(tributeSetHost.messages).toContain("tribute mset activity 1/0");
    expect(tributeSetSession.state.cards.find((card) => card.code === "950")).toMatchObject({ location: "monsterZone", position: "faceDownDefense", faceUp: false, summonType: "tribute" });
    expect(tributeSetSession.state.cards.find((card) => card.code === "500")).toMatchObject({ location: "graveyard" });
    expect(tributeSetSession.state.pendingTriggers.map((trigger) => trigger.effectId)).toContain("tribute-set-material-sent");

    const lockedTributeSetSession = createDuel({ seed: 92, startingHandSize: 2, cardReader: createCardReader([...cards, { code: "950", name: "Locked Tribute Set Source", kind: "monster", level: 5 }]) });
    loadDecks(lockedTributeSetSession, {
      0: { main: ["950", "500"] },
      1: { main: [] },
    });
    startDuel(lockedTributeSetSession);
    const lockedTributeMaterial = lockedTributeSetSession.state.cards.find((card) => card.code === "500");
    expect(lockedTributeMaterial).toBeTruthy();
    moveDuelCard(lockedTributeSetSession.state, lockedTributeMaterial!.uid, "monsterZone", 0);
    const lockedTributeSetHost = createLuaScriptHost(lockedTributeSetSession);
    const lockedTributeSetResult = lockedTributeSetHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 950), 0, LOCATION_HAND, 0, 1, 1, nil)
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_MZONE, 0, 1, 1, nil)
      local e=Effect.CreateEffect(tribute:GetFirst())
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_UNRELEASABLE_SUM)
      e:SetRange(LOCATION_MZONE)
      tribute:GetFirst():RegisterEffect(e)
      Debug.Message("locked tribute mset result " .. Duel.MSet(target, true, tribute))
      Debug.Message("locked tribute mset operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "locked-tribute-monster-set.lua",
    );
    expect(lockedTributeSetResult.ok, lockedTributeSetResult.error).toBe(true);
    expect(lockedTributeSetHost.messages).toContain("locked tribute mset result 0");
    expect(lockedTributeSetHost.messages).toContain("locked tribute mset operated 0");
    expect(lockedTributeSetSession.state.cards.find((card) => card.code === "950")).toMatchObject({ location: "hand" });
    expect(lockedTributeSetSession.state.cards.find((card) => card.code === "500")).toMatchObject({ location: "monsterZone" });

    const fullSession = createDuel({ seed: 90, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(fullSession, {
      0: { main: ["400", "500", "600", "700", "800", "900"] },
      1: { main: [] },
    });
    startDuel(fullSession);
    for (const code of ["500", "600", "700", "800", "900"]) {
      const filler = fullSession.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code);
      moveDuelCard(fullSession.state, filler!.uid, "monsterZone", 0);
    }
    const fullHost = createLuaScriptHost(fullSession);
    const fullResult = fullHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("summon zone blocked " .. Duel.Summon(target, true, nil))
      Debug.Message("mset zone blocked " .. Duel.MSet(target, true, nil))
      `,
      "basic-summon-zone-block.lua",
    );
    expect(fullResult.ok, fullResult.error).toBe(true);
    expect(fullHost.messages).toContain("summon zone blocked 0");
    expect(fullHost.messages).toContain("mset zone blocked 0");
  });

  it("lets Lua scripts choose between normal summoning and setting monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Or Set Normal", kind: "monster", level: 4 },
      { code: "200", name: "Summon Or Set Tribute", kind: "monster", level: 5 },
      { code: "300", name: "Summon Or Set Plain Set", kind: "monster", level: 4 },
    ];
    const summonSession = createDuel({ seed: 152, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(summonSession, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(summonSession);

    const summonHost = createLuaScriptHost(summonSession);
    const summonResult = summonHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("summon or set summon " .. Duel.SummonOrSet(0, target, true, nil))
      Debug.Message("summon or set summon operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "summon-or-set-summon.lua",
    );
    expect(summonResult.ok, summonResult.error).toBe(true);
    expect(summonHost.messages).toContain("summon or set summon 1");
    expect(summonHost.messages).toContain("summon or set summon operated 1/100");
    expect(summonSession.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", position: "faceUpAttack", summonType: "normal" });

    const setSession = createDuel({ seed: 153, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(setSession, {
      0: { main: ["300"] },
      1: { main: [] },
    });
    startDuel(setSession);

    const setHost = createLuaScriptHost(setSession);
    const setResult = setHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("summon or set set " .. Duel.SummonOrSet(0, target, true, nil))
      Debug.Message("summon or set set operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "summon-or-set-set.lua",
    );
    expect(setResult.ok, setResult.error).toBe(true);
    expect(setHost.messages).toContain("summon or set set 1");
    expect(setHost.messages).toContain("summon or set set operated 1/300");
    expect(setSession.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "monsterZone", position: "faceUpAttack", faceUp: true });

    const tributeSession = createDuel({ seed: 154, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(tributeSession, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(tributeSession);
    const material = tributeSession.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(material).toBeDefined();
    moveDuelCard(tributeSession.state, material!.uid, "monsterZone", 0);

    const tributeHost = createLuaScriptHost(tributeSession);
    const tributeResult = tributeHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("summon or set tribute " .. Duel.SummonOrSet(0, target, true, tribute))
      Debug.Message("summon or set tribute operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "summon-or-set-tribute.lua",
    );
    expect(tributeResult.ok, tributeResult.error).toBe(true);
    expect(tributeHost.messages).toContain("summon or set tribute 1");
    expect(tributeHost.messages).toContain("summon or set tribute operated 1/200");
    expect(tributeSession.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "monsterZone", position: "faceUpAttack", summonType: "tribute" });
    expect(tributeSession.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "graveyard" });
  });

  it("queues Lua spell/trap set triggers after SSet", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Set Spell", kind: "spell", typeFlags: 0x2 },
      { code: "200", name: "Set Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 160, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SSET)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua spell trap set resolved " .. eg:GetFirst():GetCode() .. "/" .. r .. "/" .. rp)
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-spell-trap-set-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const setResult = host.loadScript(
      `
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("sset trigger result " .. Duel.SSet(spell))
      `,
      "lua-spell-trap-set-trigger-action.lua",
    );
    expect(setResult.ok, setResult.error).toBe(true);
    expect(host.messages).toContain("sset trigger result 1");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["spellTrapSet"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1107, eventReason: 0x400, eventReasonPlayer: 0 });
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "spellTrapSet", eventCode: 1107, eventReason: 0x400, eventReasonPlayer: 0 });

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("lua spell trap set resolved 100/1024/0");
  });

  it("applies restored Lua spell/trap set triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Set Spell", kind: "spell", typeFlags: 0x2 },
      { code: "200", name: "Restore Set Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c200.lua") return undefined;
        return `
        c200={}
        function c200.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_SSET)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
            Debug.Message("restored spell trap set " .. eg:GetFirst():GetCode() .. "/" .. r .. "/" .. rp)
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 171, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const setResult = host.loadScript(
      `
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      Duel.SSet(spell)
      `,
      "restore-spell-trap-set-trigger-action.lua",
    );
    expect(setResult.ok, setResult.error).toBe(true);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["spellTrapSet"]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["spellTrapSet"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1107, eventReason: 0x400, eventReasonPlayer: 0 });
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored spell trap set 100/1024/0");
  });

  it("queues Lua monster-set triggers after MSet", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Set Monster", kind: "monster" },
      { code: "200", name: "Monster Set Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 163, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_MSET)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("lua monster set resolved " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-monster-set-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const setResult = host.loadScript(
      `
      local monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("mset trigger result " .. Duel.MSet(monster, true, nil))
      `,
      "lua-monster-set-trigger-action.lua",
    );
    expect(setResult.ok, setResult.error).toBe(true);
    expect(host.messages).toContain("mset trigger result 1");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["monsterSet"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1106 });
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "monsterSet", eventCode: 1106 });

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("lua monster set resolved 100");
  });

  it("applies restored Lua monster-set triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Set Monster", kind: "monster" },
      { code: "200", name: "Restore Monster Set Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c200.lua") return undefined;
        return `
        c200={}
        function c200.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_MSET)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg)
            Debug.Message("restored monster set " .. eg:GetFirst():GetCode())
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 170, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const setResult = host.loadScript(
      `
      local monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      Duel.MSet(monster, true, nil)
      `,
      "restore-monster-set-trigger-action.lua",
    );
    expect(setResult.ok, setResult.error).toBe(true);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["monsterSet"]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["monsterSet"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1106 });
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored monster set 100");
  });

  it("makes earlier Lua optional when triggers miss timing at SSet boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "SSet Boundary Source", kind: "monster" },
      { code: "200", name: "SSet Boundary Target", kind: "monster" },
      { code: "300", name: "When To Grave Watcher", kind: "monster" },
      { code: "400", name: "If To Grave Watcher", kind: "monster" },
      { code: "500", name: "SSet Boundary Spell", kind: "spell", typeFlags: 0x2 },
      { code: "600", name: "SSet Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 161, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300", "400", "500", "600"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil)
      local set_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.SendtoGrave(target, REASON_EFFECT)
        Duel.SSet(spell)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_TO_GRAVE)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when to grave resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_TO_GRAVE)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if to grave resolved")
      end)
      if_watcher:RegisterEffect(if_effect)

      local set_effect=Effect.CreateEffect(set_watcher)
      set_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      set_effect:SetCode(EVENT_SSET)
      set_effect:SetRange(LOCATION_HAND)
      set_effect:SetOperation(function(e,tp)
        Debug.Message("sset boundary resolved")
      end)
      set_watcher:RegisterEffect(set_effect)
      `,
      "sset-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1014");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1014", "lua-4-1107"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "sentToGraveyard", eventCode: 1014 }), expect.objectContaining({ eventName: "spellTrapSet", eventCode: 1107 })]),
    );
  });

  it("makes Lua optional when SSet triggers miss timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "SSet Later Boundary Source", kind: "monster" },
      { code: "300", name: "When SSet Watcher", kind: "monster" },
      { code: "400", name: "If SSet Watcher", kind: "monster" },
      { code: "500", name: "SSet Later Boundary Spell", kind: "spell", typeFlags: 0x2 },
      { code: "600", name: "Damage Boundary Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 162, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "400", "500", "600"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local when_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local if_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil)
      local damage_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        Duel.SSet(spell)
        Duel.Damage(1, 100, REASON_EFFECT)
      end)
      source:RegisterEffect(e)

      local when_effect=Effect.CreateEffect(when_watcher)
      when_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      when_effect:SetCode(EVENT_SSET)
      when_effect:SetRange(LOCATION_HAND)
      when_effect:SetOperation(function(e,tp)
        Debug.Message("when sset resolved")
      end)
      when_watcher:RegisterEffect(when_effect)

      local if_effect=Effect.CreateEffect(if_watcher)
      if_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      if_effect:SetCode(EVENT_SSET)
      if_effect:SetProperty(EFFECT_FLAG_DELAY)
      if_effect:SetRange(LOCATION_HAND)
      if_effect:SetOperation(function(e,tp)
        Debug.Message("if sset resolved")
      end)
      if_watcher:RegisterEffect(if_effect)

      local damage_effect=Effect.CreateEffect(damage_watcher)
      damage_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      damage_effect:SetCode(EVENT_DAMAGE)
      damage_effect:SetRange(LOCATION_HAND)
      damage_effect:SetOperation(function(e,tp)
        Debug.Message("damage boundary resolved")
      end)
      damage_watcher:RegisterEffect(damage_effect)
      `,
      "sset-later-boundary-missed-timing.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1107");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1107", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "spellTrapSet", eventCode: 1107 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );
  });

  it("lets Lua scripts set spells and traps", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Set Spell", kind: "spell", typeFlags: 0x2 },
      { code: "200", name: "Set Trap", kind: "trap", typeFlags: 0x4 },
      { code: "300", name: "Rejected Monster", kind: "monster" },
      { code: "400", name: "Zone Blocked Spell", kind: "spell", typeFlags: 0x2 },
      { code: "500", name: "Zone Filler A", kind: "spell", typeFlags: 0x2 },
      { code: "600", name: "Zone Filler B", kind: "spell", typeFlags: 0x2 },
      { code: "700", name: "Zone Filler C", kind: "spell", typeFlags: 0x2 },
      { code: "800", name: "Zone Filler D", kind: "spell", typeFlags: 0x2 },
      { code: "900", name: "Zone Filler E", kind: "spell", typeFlags: 0x2 },
      { code: "1000", name: "Deck Set Spell", kind: "spell", typeFlags: 0x2 },
    ];
    const setSession = createDuel({ seed: 91, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(setSession, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(setSession);

    const setHost = createLuaScriptHost(setSession);
    const setResult = setHost.loadScript(
      `
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local trap = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil)
      local monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("sset spell result " .. Duel.SSet(spell))
      Debug.Message("sset spell operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("sset trap result " .. Duel.SSet(trap))
      Debug.Message("sset monster rejected " .. Duel.SSet(monster))
      Debug.Message("sset rejected operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("sset empty result " .. Duel.SSet(Group.CreateGroup()))
      Debug.Message("sset empty operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("can set spell trap hand " .. tostring(Duel.CanPlayerSetSpellTrap(0, spell:GetFirst())) .. "/" .. tostring(Duel.CanPlayerSetSpellTrap(0, monster:GetFirst())))
      `,
      "basic-spell-trap-set.lua",
    );
    expect(setResult.ok, setResult.error).toBe(true);
    expect(setHost.messages).toContain("sset spell result 1");
    expect(setHost.messages).toContain("sset spell operated 1/100");
    expect(setHost.messages).toContain("sset trap result 1");
    expect(setHost.messages).toContain("sset monster rejected 0");
    expect(setHost.messages).toContain("sset rejected operated 0");
    expect(setHost.messages).toContain("sset empty result 0");
    expect(setHost.messages).toContain("sset empty operated 0");
    expect(setHost.messages).toContain("can set spell trap hand true/false");
    expect(setSession.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "spellTrapZone", position: "faceDown", faceUp: false });
    expect(setSession.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "spellTrapZone", position: "faceDown", faceUp: false });

    const fullSession = createDuel({ seed: 92, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(fullSession, {
      0: { main: ["400", "500", "600", "700", "800", "900"] },
      1: { main: [] },
    });
    startDuel(fullSession);
    for (const code of ["500", "600", "700", "800", "900"]) {
      const filler = fullSession.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code);
      moveDuelCard(fullSession.state, filler!.uid, "spellTrapZone", 0);
    }
    const fullHost = createLuaScriptHost(fullSession);
    const fullResult = fullHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("sset zone blocked " .. Duel.SSet(target))
      `,
      "basic-spell-trap-set-zone-block.lua",
    );
    expect(fullResult.ok, fullResult.error).toBe(true);
    expect(fullHost.messages).toContain("sset zone blocked 0");
    const blockedResult = fullHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("can set spell trap blocked " .. tostring(Duel.CanPlayerSetSpellTrap(0, target)))
      `,
      "basic-spell-trap-set-can-blocked.lua",
    );
    expect(blockedResult.ok, blockedResult.error).toBe(true);
    expect(fullHost.messages).toContain("can set spell trap blocked false");

    const trapMonsterSession = createDuel({ seed: 159, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(trapMonsterSession, {
      0: { main: ["200", "500", "600", "700", "800", "900"] },
      1: { main: [] },
    });
    startDuel(trapMonsterSession);
    const trapMonster = trapMonsterSession.state.cards.find((card) => card.code === "200");
    moveDuelCard(trapMonsterSession.state, trapMonster!.uid, "monsterZone", 0);
    const trapMonsterHost = createLuaScriptHost(trapMonsterSession);
    const trapMonsterResult = trapMonsterHost.loadScript(
      `
      local trap_monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("can set trap monster " .. tostring(Duel.CanPlayerSetSpellTrap(0, trap_monster)))
      `,
      "basic-spell-trap-set-can-trap-monster.lua",
    );
    expect(trapMonsterResult.ok, trapMonsterResult.error).toBe(true);
    expect(trapMonsterHost.messages).toContain("can set trap monster true");

    const deckSetSession = createDuel({ seed: 160, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(deckSetSession, {
      0: { main: ["1000"] },
      1: { main: [] },
    });
    startDuel(deckSetSession);
    const deckSetHost = createLuaScriptHost(deckSetSession);
    const deckSetResult = deckSetHost.loadScript(
      `
      local spell = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 1000), 0, LOCATION_DECK, 0, 1, 1, nil):GetFirst()
      Debug.Message("deck ssetable " .. tostring(spell:IsSSetable()))
      Debug.Message("deck sset result " .. Duel.SSet(0, spell))
      Debug.Message("deck sset operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "basic-spell-trap-set-from-deck.lua",
    );
    expect(deckSetResult.ok, deckSetResult.error).toBe(true);
    expect(deckSetHost.messages).toContain("deck ssetable true");
    expect(deckSetHost.messages).toContain("deck sset result 1");
    expect(deckSetHost.messages).toContain("deck sset operated 1/1000");
    expect(deckSetSession.state.cards.find((card) => card.code === "1000")).toMatchObject({ location: "spellTrapZone", position: "faceDown", faceUp: false });
  });

  it("lets Lua scripts tribute summon with explicit release cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Tribute Summon Target", kind: "monster", level: 7 },
      { code: "200", name: "Tribute A", kind: "monster", level: 4 },
      { code: "300", name: "Tribute B", kind: "monster", level: 4 },
      { code: "400", name: "Wrong Hand Tribute", kind: "monster", level: 4 },
    ];
    const successSession = createDuel({ seed: 93, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(successSession, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(successSession);
    for (const code of ["200", "300"]) {
      const tribute = successSession.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code);
      moveDuelCard(successSession.state, tribute!.uid, "monsterZone", 0);
    }

    const successHost = createLuaScriptHost(successSession);
    const successResult = successHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local tributes = Duel.SelectMatchingCard(0, function(c) return c:IsCode(200) or c:IsCode(300) end, 0, LOCATION_MZONE, 0, 2, 2, nil)
      Debug.Message("tribute summon result " .. Duel.Summon(target, true, tributes))
      Debug.Message("tribute summon operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("tribute summoned predicate " .. tostring(Duel.GetOperatedGroup():GetFirst():IsTributeSummoned()))
      `,
      "basic-tribute-summon.lua",
    );
    expect(successResult.ok, successResult.error).toBe(true);
    expect(successHost.messages).toContain("tribute summon result 1");
    expect(successHost.messages).toContain("tribute summon operated 1/100");
    expect(successHost.messages).toContain("tribute summoned predicate true");
    expect(successSession.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", position: "faceUpAttack", summonType: "tribute" });
    expect(successSession.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "graveyard" });
    expect(successSession.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "graveyard" });

    const tableSession = createDuel({ seed: 94, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(tableSession, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(tableSession);
    for (const code of ["200", "300"]) {
      const tribute = tableSession.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code);
      moveDuelCard(tableSession.state, tribute!.uid, "monsterZone", 0);
    }
    const tableHost = createLuaScriptHost(tableSession);
    const tableResult = tableHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local tribute_a = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local tribute_b = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("tribute table result " .. Duel.Summon(target, true, {tribute_a, tribute_b}))
      `,
      "basic-tribute-table-summon.lua",
    );
    expect(tableResult.ok, tableResult.error).toBe(true);
    expect(tableHost.messages).toContain("tribute table result 1");
    expect(tableSession.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", summonType: "tribute" });

    const doubleSession = createDuel({ seed: 96, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(doubleSession, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(doubleSession);
    const doubleMaterial = doubleSession.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    moveDuelCard(doubleSession.state, doubleMaterial!.uid, "monsterZone", 0);
    const doubleHost = createLuaScriptHost(doubleSession);
    const doubleResult = doubleHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local tribute = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil)
      tribute:GetFirst():RegisterFlagEffect(FLAG_HAS_DOUBLE_TRIBUTE,RESET_EVENT,0,1)
      Debug.Message("tribute double summon result " .. Duel.Summon(target, true, tribute))
      Debug.Message("tribute double operated " .. Duel.GetOperatedGroup():GetCount() .. "/" .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "basic-double-tribute-summon.lua",
    );
    expect(doubleResult.ok, doubleResult.error).toBe(true);
    expect(doubleHost.messages).toContain("tribute double summon result 1");
    expect(doubleHost.messages).toContain("tribute double operated 1/100");
    expect(doubleSession.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", summonType: "tribute" });
    expect(doubleSession.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "graveyard" });

    const overpaySession = createDuel({ seed: 97, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(overpaySession, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(overpaySession);
    for (const code of ["200", "300"]) {
      const tribute = overpaySession.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code);
      moveDuelCard(overpaySession.state, tribute!.uid, "monsterZone", 0);
    }
    const overpayHost = createLuaScriptHost(overpaySession);
    const overpayResult = overpayHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local tribute = Duel.SelectMatchingCard(0, function(c) return c:IsCode(200) or c:IsCode(300) end, 0, LOCATION_MZONE, 0, 2, 2, nil)
      tribute:Filter(Card.IsCode,nil,200):GetFirst():RegisterFlagEffect(FLAG_HAS_DOUBLE_TRIBUTE,RESET_EVENT,0,1)
      Debug.Message("tribute double overpay result " .. Duel.Summon(target, true, tribute))
      Debug.Message("tribute double overpay operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "basic-double-tribute-overpay.lua",
    );
    expect(overpayResult.ok, overpayResult.error).toBe(true);
    expect(overpayHost.messages).toContain("tribute double overpay result 0");
    expect(overpayHost.messages).toContain("tribute double overpay operated 0");
    expect(overpaySession.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "hand" });
    expect(overpaySession.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "monsterZone" });
    expect(overpaySession.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "monsterZone" });

    const failureSession = createDuel({ seed: 95, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(failureSession, {
      0: { main: ["100", "400"] },
      1: { main: [] },
    });
    startDuel(failureSession);
    const failureHost = createLuaScriptHost(failureSession);
    const failureResult = failureHost.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      local wrong = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("tribute missing result " .. Duel.Summon(target, true, nil))
      Debug.Message("tribute wrong result " .. Duel.Summon(target, true, wrong))
      Debug.Message("tribute wrong operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "basic-tribute-summon-failures.lua",
    );
    expect(failureResult.ok, failureResult.error).toBe(true);
    expect(failureHost.messages).toContain("tribute missing result 0");
    expect(failureHost.messages).toContain("tribute wrong result 0");
    expect(failureHost.messages).toContain("tribute wrong operated 0");
    expect(failureSession.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "hand" });
  });

});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  assertPublicRestoreMetadata(restored, response);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function assertPublicRestoreMetadata(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: ReturnType<typeof applyLuaRestoreResponse>): void {
  const publicState = queryPublicState(restored.session);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) {
    expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  } else {
    expect(response.state).not.toHaveProperty("triggerOrderPrompt");
  }
}
