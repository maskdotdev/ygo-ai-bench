import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness list validation", () => {
  it("rejects malformed top-level fixture fields before duel setup", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const malformedBefore = { ["source"]: "local", note: 5 };
    const malformedExpected = { ["source"]: "parity-backlog" };
    const result = runScriptedDuelFixture({
      name: 7,
      options: { seed: 66, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: "setup",
      before: malformedBefore,
      responses: [],
      expected: malformedExpected,
      typo: true,
    } as never, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "<malformed fixture>", message: "Expected fixture.name has malformed value 7" },
      { fixture: "<malformed fixture>", message: "Expected fixture.setup has malformed value setup" },
      { fixture: "<malformed fixture>", message: "Expected fixture.before.source has malformed value local" },
      { fixture: "<malformed fixture>", message: "Expected fixture.before.note has malformed value 5" },
      { fixture: "<malformed fixture>", message: "Expected fixture.expected.note has malformed value undefined" },
      { fixture: "<malformed fixture>", message: "Expected fixture has malformed key typo" },
    ]);
  });

  it("rejects missing final expected window before duel setup", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "missing expected fixture",
      options: { seed: 66, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      responses: [],
    } as never, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "missing expected fixture", message: "Expected fixture.expected has malformed value undefined" },
    ]);
  });

  it("rejects malformed fixture options before duel setup", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed fixture options",
      options: {
        seed: {},
        startingLifePoints: -1,
        startingHandSize: Number.NaN,
        drawPerTurn: 1.5,
        duelTypeFlags: Number.POSITIVE_INFINITY,
        mode: "bad",
      } as never,
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed fixture options", message: "Expected options.startingLifePoints has malformed value -1" },
      { fixture: "malformed fixture options", message: "Expected options.startingHandSize has malformed value NaN" },
      { fixture: "malformed fixture options", message: "Expected options.drawPerTurn has malformed value 1.5" },
      { fixture: "malformed fixture options", message: "Expected options.duelTypeFlags has malformed value Infinity" },
      { fixture: "malformed fixture options", message: "Expected options.seed has malformed value [object Object]" },
      { fixture: "malformed fixture options", message: "Expected options has malformed key mode" },
    ]);
  });

  it("rejects malformed fixture decks before duel setup", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed fixture decks",
      options: { seed: 66, startingHandSize: 1 },
      decks: {
        0: { main: ["100", 200], extra: "extra", side: ["300"] },
        1: "deck",
      } as never,
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed fixture decks", message: "Expected decks.0.main[1] has malformed value 200" },
      { fixture: "malformed fixture decks", message: "Expected decks.0.extra has malformed value extra" },
      { fixture: "malformed fixture decks", message: "Expected decks.0 has malformed key side" },
      { fixture: "malformed fixture decks", message: "Expected decks.1 has malformed value deck" },
    ]);
  });

  it("rejects malformed setup list containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed setup list fixture",
      options: { seed: 66, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: "move" as never,
        effects: { id: "effect" } as never,
        collectEvents: 1 as never,
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed setup list fixture", message: "Expected setup.moveCards has malformed value move" },
      { fixture: "malformed setup list fixture", message: "Expected setup.effects has malformed value [object Object]" },
      { fixture: "malformed setup list fixture", message: "Expected setup.collectEvents has malformed value 1" },
    ]);
  });

  it("rejects malformed setup keys before duel setup", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed setup key fixture",
      options: { seed: 66, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [],
        effects: [],
        collectEvents: [],
        stale: true,
      } as never,
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed setup key fixture", message: "Expected fixture.setup has malformed key stale" },
    ]);
  });

  it("rejects malformed response list containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed response list fixture",
      options: { seed: 66, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      responses: "activate" as never,
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed response list fixture", message: "Expected responses has malformed value activate" },
    ]);
  });

  it("rejects malformed setup prompt containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed setup prompt container fixture",
      options: { seed: 66, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        prompt: "choose" as never,
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed setup prompt container fixture", message: "Expected setup.prompt has malformed value choose" },
    ]);
  });

  it("rejects malformed setup prompt fields", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed setup prompt fixture",
      options: { seed: 66, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        prompt: {
          id: 7,
          type: "selectOption",
          player: 2,
          options: [1, Number.NaN, 1],
          returnTo: 3,
          description: 10,
          stale: true,
        } as never,
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed setup prompt fixture", message: "Expected setup.prompt.id has malformed value 7" },
      { fixture: "malformed setup prompt fixture", message: "Expected setup.prompt.player has malformed player 2" },
      { fixture: "malformed setup prompt fixture", message: "Expected setup.prompt.returnTo has malformed player 3" },
      { fixture: "malformed setup prompt fixture", message: "Expected setup.prompt.options[1] has malformed value NaN" },
      { fixture: "malformed setup prompt fixture", message: "Expected setup.prompt.options has duplicate values" },
      { fixture: "malformed setup prompt fixture", message: "Expected setup.prompt.description has malformed field for selectOption" },
      { fixture: "malformed setup prompt fixture", message: "Expected setup.prompt has malformed key stale" },
    ]);
  });

  it("rejects malformed setup yes-no prompt fields", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed setup yes-no prompt fixture",
      options: { seed: 66, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        prompt: {
          id: "prompt",
          type: "selectYesNo",
          player: 0,
          description: Number.NaN,
          options: [1],
        } as never,
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed setup yes-no prompt fixture", message: "Expected setup.prompt.description has malformed value NaN" },
      { fixture: "malformed setup yes-no prompt fixture", message: "Expected setup.prompt.options has malformed field for selectYesNo" },
    ]);
  });

  it("rejects malformed response steps", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const malformedAfter = { ["source"]: "parity-backlog" };
    const result = runScriptedDuelFixture({
      name: "malformed response step fixture",
      options: { seed: 66, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      responses: [
        "step" as never,
        { response: "activate" } as never,
        {
          response: {
            type: "bogus",
            player: 2,
            windowId: -1,
            windowKind: "combat",
            windowToken: "",
            code: 100,
            uid: 7,
            tributeUids: ["ok", 8],
            materialUids: "materials",
            summonUids: [false],
            position: "standing",
            phase: "combat",
            attackerUid: 9,
            targetUid: false,
            directAttack: "yes",
            promptId: 1,
            option: Number.NaN,
            yes: "no",
            effectId: 3,
            triggerId: 4,
            triggerBucket: "later",
            location: "field",
            labelIncludes: 5,
            occurrence: -1,
            stale: true,
          } as never,
          snapshotRestore: "before",
          typo: true,
        } as never,
        { response: { type: "endTurn", player: 0 }, snapshotRestore: "during" } as never,
        { response: { type: "endTurn", player: 0 }, before: "before", after: malformedAfter } as never,
        { response: { type: "endTurn", player: 0, label: false } as never },
        { response: { type: "tributeSummon", player: 0, tributeUids: ["ok", 8] } as never },
      ],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed response step fixture", message: "responses[0] has malformed value step" },
      { fixture: "malformed response step fixture", message: "responses[1].response has malformed value activate" },
      { fixture: "malformed response step fixture", message: "responses[2].response.type has malformed value bogus" },
      { fixture: "malformed response step fixture", message: "responses[2].response.player has malformed player 2" },
      { fixture: "malformed response step fixture", message: "responses[2].response.windowId has malformed value -1" },
      { fixture: "malformed response step fixture", message: "responses[2].response.code has malformed value 100" },
      { fixture: "malformed response step fixture", message: "responses[2].response has malformed key stale" },
      { fixture: "malformed response step fixture", message: "responses[2] has malformed key typo" },
      { fixture: "malformed response step fixture", message: "responses[3].snapshotRestore has malformed value during" },
      { fixture: "malformed response step fixture", message: "Expected responses[4].before has malformed value before" },
      { fixture: "malformed response step fixture", message: "Expected responses[4].after.note has malformed value undefined" },
      { fixture: "malformed response step fixture", message: "responses[5].response.label has malformed value false" },
      { fixture: "malformed response step fixture", message: "responses[6].response.tributeUids[1] has malformed value 8" },
    ]);
  });

  it("rejects malformed setup effect list containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed setup effect list fixture",
      options: { seed: 67, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        effects: [{
          id: "effect",
          player: 0,
          code: "100",
          event: "ignition",
          range: ["hand"],
          targetCardsOnActivation: "target" as never,
          collectEventsOnResolve: { collectEvent: "sentToGraveyard" } as never,
          drawCardsOnResolve: 1 as never,
          moveCardsOnResolve: false as never,
        }],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed setup effect list fixture", message: "Setup effect effect targetCardsOnActivation has malformed value target" },
      { fixture: "malformed setup effect list fixture", message: "Setup effect effect collectEventsOnResolve has malformed value [object Object]" },
      { fixture: "malformed setup effect list fixture", message: "Setup effect effect drawCardsOnResolve has malformed value 1" },
      { fixture: "malformed setup effect list fixture", message: "Setup effect effect moveCardsOnResolve has malformed value false" },
    ]);
  });

  it("rejects malformed setup effect entries by index", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed setup effect entry fixture",
      options: { seed: 67, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        effects: ["effect" as never],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed setup effect entry fixture", message: "setup.effects[0] has malformed value effect" },
    ]);
  });

  it("rejects malformed setup effect scalar fields", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed setup effect scalar fixture",
      options: { seed: 67, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        effects: [{
          id: 7,
          player: 2,
          code: 100,
          location: "field",
          event: "counter",
          effectCode: 1.5,
          luaTypeFlags: Number.NaN,
          value: Number.POSITIVE_INFINITY,
          valueCardCode: 100,
          targetCardCode: 100,
          targetRange: [1, 1.5, 2],
          triggerEvent: "notAnEvent",
          triggerCode: -0.5,
          triggerTiming: "after",
          eventCardCode: 200,
          optional: "yes",
          range: ["hand", "nowhere"],
          oncePerTurn: 1,
          property: 1.5,
          activationChain: "both",
          logMessage: 8,
          negateChainEffectOnResolve: 9,
          negateAttackOnResolve: "no",
          negateSummonOnResolve: { player: -1, code: 300, location: "field", occurrence: -1, typo: true },
          chainLimitOnTarget: { untilChainEnd: "yes", allowPlayer: 3, typo: true },
          occurrence: Number.NaN,
          typo: true,
        } as never],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.id has malformed value 7" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.player has malformed player 2" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.code has malformed value 100" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.location has malformed value field" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.event has malformed value counter" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.effectCode has malformed value 1.5" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.luaTypeFlags has malformed value NaN" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.value has malformed value Infinity" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.valueCardCode has malformed value 100" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.targetCardCode has malformed value 100" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.targetRange has malformed value 1,1.5,2" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.triggerEvent has malformed value notAnEvent" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.triggerCode has malformed value -0.5" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.triggerTiming has malformed value after" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.eventCardCode has malformed value 200" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.optional has malformed value yes" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.range[1] has malformed value nowhere" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.oncePerTurn has malformed value 1" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.property has malformed value 1.5" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.activationChain has malformed value both" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.logMessage has malformed value 8" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.negateChainEffectOnResolve has malformed value 9" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.negateAttackOnResolve has malformed value no" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.negateSummonOnResolve.player has malformed player -1" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.negateSummonOnResolve.code has malformed value 300" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.negateSummonOnResolve.location has malformed value field" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.negateSummonOnResolve.occurrence has malformed value -1" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.negateSummonOnResolve has malformed key typo" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.chainLimitOnTarget.untilChainEnd has malformed value yes" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.chainLimitOnTarget.allowPlayer has malformed player 3" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.chainLimitOnTarget has malformed key typo" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect.occurrence has malformed value NaN" },
      { fixture: "malformed setup effect scalar fixture", message: "Setup effect 7 effect has malformed key typo" },
    ]);
  });

  it("rejects malformed setup move operations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed setup move fixture",
      options: { seed: 67, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [
          "move" as never,
          {
            player: 2,
            code: 100,
            from: "field",
            to: "nowhere",
            controller: -1,
            position: "standing",
            occurrence: -1,
            moveReason: 1.5,
            moveReasonPlayer: 3,
            collectEvent: "notAnEvent",
            eventCode: Number.NaN,
            eventIsLast: "no",
            eventPlayer: 4,
            eventValue: 1.5,
            eventReason: Number.POSITIVE_INFINITY,
            eventReasonPlayer: 5,
            eventReasonCardUid: 9,
            eventReasonEffectId: Number.NaN,
            relatedEffectId: 1.5,
            eventChainDepth: -0.5,
            eventChainLinkId: 6,
            eventUids: ["ok", 8],
            typo: true,
          } as never,
        ],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed setup move fixture", message: "setup.moveCards[0] has malformed value move" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].player has malformed player 2" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].code has malformed value 100" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].from has malformed value field" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].to has malformed value nowhere" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].controller has malformed player -1" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].position has malformed value standing" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].occurrence has malformed value -1" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].moveReason has malformed value 1.5" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].moveReasonPlayer has malformed player 3" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].collectEvent has malformed value notAnEvent" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].eventCode has malformed value NaN" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].eventIsLast has malformed value no" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].eventPlayer has malformed player 4" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].eventValue has malformed value 1.5" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].eventReason has malformed value Infinity" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].eventReasonPlayer has malformed player 5" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].eventReasonCardUid has malformed value 9" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].eventReasonEffectId has malformed value NaN" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].relatedEffectId has malformed value 1.5" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].eventChainDepth has malformed value -0.5" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].eventChainLinkId has malformed value 6" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1].eventUids[1] has malformed value 8" },
      { fixture: "malformed setup move fixture", message: "setup.moveCards[1] has malformed key typo" },
    ]);
  });

  it("rejects malformed setup collected events", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed setup collected event fixture",
      options: { seed: 67, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        collectEvents: [
          "event" as never,
          {
            collectEvent: "notAnEvent",
            eventCard: { player: 2, code: 100, location: "field", occurrence: -1, typo: true },
            eventCode: 1.5,
            eventIsLast: "yes",
            eventPlayer: -1,
            eventValue: Number.NaN,
            eventReason: Number.POSITIVE_INFINITY,
            eventReasonPlayer: 4,
            eventReasonCardUid: 8,
            eventReasonEffectId: 1.5,
            relatedEffectId: Number.NaN,
            eventChainDepth: -0.5,
            eventChainLinkId: 9,
            eventUids: ["ok", 8],
            typo: true,
          } as never,
        ],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[0] has malformed value event" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].collectEvent has malformed value notAnEvent" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].eventCard.player has malformed player 2" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].eventCard.code has malformed value 100" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].eventCard.location has malformed value field" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].eventCard.occurrence has malformed value -1" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].eventCard has malformed key typo" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].eventCode has malformed value 1.5" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].eventIsLast has malformed value yes" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].eventPlayer has malformed player -1" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].eventValue has malformed value NaN" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].eventReason has malformed value Infinity" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].eventReasonPlayer has malformed player 4" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].eventReasonCardUid has malformed value 8" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].eventReasonEffectId has malformed value 1.5" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].relatedEffectId has malformed value NaN" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].eventChainDepth has malformed value -0.5" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].eventChainLinkId has malformed value 9" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1].eventUids[1] has malformed value 8" },
      { fixture: "malformed setup collected event fixture", message: "setup.collectEvents[1] has malformed key typo" },
    ]);
  });

  it("rejects malformed setup effect target selectors", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed setup effect target selector fixture",
      options: { seed: 68, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        effects: [{
          id: "effect",
          player: 0,
          code: "100",
          event: "ignition",
          range: ["hand"],
          targetCardsOnActivation: [
            "target" as never,
            { player: 2, code: 100, location: "field", occurrence: -1, typo: true } as never,
          ],
        }],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed setup effect target selector fixture", message: "Setup effect effect targetCardsOnActivation[0] has malformed value target" },
      { fixture: "malformed setup effect target selector fixture", message: "Setup effect effect targetCardsOnActivation[1].player has malformed player 2" },
      { fixture: "malformed setup effect target selector fixture", message: "Setup effect effect targetCardsOnActivation[1].code has malformed value 100" },
      { fixture: "malformed setup effect target selector fixture", message: "Setup effect effect targetCardsOnActivation[1].location has malformed value field" },
      { fixture: "malformed setup effect target selector fixture", message: "Setup effect effect targetCardsOnActivation[1].occurrence has malformed value -1" },
      { fixture: "malformed setup effect target selector fixture", message: "Setup effect effect targetCardsOnActivation[1] has malformed key typo" },
    ]);
  });

  it("rejects malformed setup effect draw operations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed setup effect draw fixture",
      options: { seed: 69, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        effects: [{
          id: "effect",
          player: 0,
          code: "100",
          event: "ignition",
          range: ["hand"],
          drawCardsOnResolve: [
            "draw" as never,
            {
              player: 2,
              count: 0,
              detail: 7,
              eventIsLast: "yes",
              eventReason: 1.5,
              eventReasonPlayer: -1,
              eventReasonCardUid: 9,
              eventReasonEffectId: Number.POSITIVE_INFINITY,
              typo: true,
            } as never,
          ],
        }],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed setup effect draw fixture", message: "Setup effect effect drawCardsOnResolve[0] has malformed value draw" },
      { fixture: "malformed setup effect draw fixture", message: "Setup effect effect drawCardsOnResolve[1].player has malformed player 2" },
      { fixture: "malformed setup effect draw fixture", message: "Setup effect effect drawCardsOnResolve[1].count has malformed value 0" },
      { fixture: "malformed setup effect draw fixture", message: "Setup effect effect drawCardsOnResolve[1].detail has malformed value 7" },
      { fixture: "malformed setup effect draw fixture", message: "Setup effect effect drawCardsOnResolve[1].eventIsLast has malformed value yes" },
      { fixture: "malformed setup effect draw fixture", message: "Setup effect effect drawCardsOnResolve[1].eventReason has malformed value 1.5" },
      { fixture: "malformed setup effect draw fixture", message: "Setup effect effect drawCardsOnResolve[1].eventReasonPlayer has malformed player -1" },
      { fixture: "malformed setup effect draw fixture", message: "Setup effect effect drawCardsOnResolve[1].eventReasonCardUid has malformed value 9" },
      { fixture: "malformed setup effect draw fixture", message: "Setup effect effect drawCardsOnResolve[1].eventReasonEffectId has malformed value Infinity" },
      { fixture: "malformed setup effect draw fixture", message: "Setup effect effect drawCardsOnResolve[1] has malformed key typo" },
    ]);
  });

  it("rejects malformed setup effect collected events", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed setup effect collected event fixture",
      options: { seed: 70, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        effects: [{
          id: "effect",
          player: 0,
          code: "100",
          event: "ignition",
          range: ["hand"],
          collectEventsOnResolve: [
            "event" as never,
            {
              collectEvent: "notAnEvent",
              eventCard: { player: 2, code: 100, location: "field", occurrence: -1, typo: true },
              eventCode: 1.5,
              eventIsLast: "yes",
              eventPlayer: -1,
              eventValue: Number.NaN,
              eventReason: Number.POSITIVE_INFINITY,
              eventReasonPlayer: 4,
              eventReasonCardUid: 8,
              eventReasonEffectId: 1.5,
              relatedEffectId: Number.NaN,
              eventChainDepth: -0.5,
              eventChainLinkId: 9,
              eventUids: ["ok", 8],
              typo: true,
            } as never,
          ],
        }],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[0] has malformed value event" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].collectEvent has malformed value notAnEvent" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].eventCard.player has malformed player 2" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].eventCard.code has malformed value 100" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].eventCard.location has malformed value field" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].eventCard.occurrence has malformed value -1" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].eventCard has malformed key typo" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].eventCode has malformed value 1.5" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].eventIsLast has malformed value yes" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].eventPlayer has malformed player -1" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].eventValue has malformed value NaN" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].eventReason has malformed value Infinity" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].eventReasonPlayer has malformed player 4" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].eventReasonCardUid has malformed value 8" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].eventReasonEffectId has malformed value 1.5" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].relatedEffectId has malformed value NaN" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].eventChainDepth has malformed value -0.5" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].eventChainLinkId has malformed value 9" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1].eventUids[1] has malformed value 8" },
      { fixture: "malformed setup effect collected event fixture", message: "Setup effect effect collectEventsOnResolve[1] has malformed key typo" },
    ]);
  });

  it("rejects malformed setup effect move operations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed setup effect move fixture",
      options: { seed: 70, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        effects: [{
          id: "effect",
          player: 0,
          code: "100",
          event: "ignition",
          range: ["hand"],
          moveCardsOnResolve: [
            "move" as never,
            {
              player: 2,
              code: 100,
              from: "field",
              to: "nowhere",
              controller: -1,
              position: "standing",
              occurrence: -1,
              moveReason: 1.5,
              moveReasonPlayer: 3,
              collectEvent: "notAnEvent",
              eventCode: Number.NaN,
              eventIsLast: "no",
              eventPlayer: 4,
              eventValue: 1.5,
              eventReason: Number.POSITIVE_INFINITY,
              eventReasonPlayer: 5,
              eventReasonCardUid: 9,
              eventReasonEffectId: Number.NaN,
              relatedEffectId: 1.5,
              eventChainDepth: -0.5,
              eventChainLinkId: 6,
              eventUids: ["ok", 8],
              typo: true,
            } as never,
          ],
        }],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[0] has malformed value move" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].player has malformed player 2" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].code has malformed value 100" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].from has malformed value field" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].to has malformed value nowhere" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].controller has malformed player -1" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].position has malformed value standing" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].occurrence has malformed value -1" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].moveReason has malformed value 1.5" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].moveReasonPlayer has malformed player 3" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].collectEvent has malformed value notAnEvent" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].eventCode has malformed value NaN" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].eventIsLast has malformed value no" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].eventPlayer has malformed player 4" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].eventValue has malformed value 1.5" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].eventReason has malformed value Infinity" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].eventReasonPlayer has malformed player 5" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].eventReasonCardUid has malformed value 9" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].eventReasonEffectId has malformed value NaN" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].relatedEffectId has malformed value 1.5" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].eventChainDepth has malformed value -0.5" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].eventChainLinkId has malformed value 6" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1].eventUids[1] has malformed value 8" },
      { fixture: "malformed setup effect move fixture", message: "Setup effect effect moveCardsOnResolve[1] has malformed key typo" },
    ]);
  });

  it("rejects malformed list expectation containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed list expectation fixture",
      options: { seed: 65, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        lastDiceResults: { value: 1 } as never,
        chainPasses: "0" as never,
        legalActions: { player: 0 } as never,
        absentLegalActions: "none" as never,
        legalActionGroups: 1 as never,
        absentLegalActionGroups: null as never,
        logIncludes: { detail: "draw" } as never,
        attackedTargetUids: 7 as never,
        battlePairs: "attack" as never,
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed list expectation fixture",
        message: "before fixture (edopro): Expected lastDiceResults has malformed value [object Object]",
      },
      {
        fixture: "malformed list expectation fixture",
        message: "before fixture (edopro): Expected chainPasses has malformed value 0",
      },
      {
        fixture: "malformed list expectation fixture",
        message: "before fixture (edopro): Expected legalActions has malformed value [object Object]",
      },
      {
        fixture: "malformed list expectation fixture",
        message: "before fixture (edopro): Expected absentLegalActions has malformed value none",
      },
      {
        fixture: "malformed list expectation fixture",
        message: "before fixture (edopro): Expected legalActionGroups has malformed value 1",
      },
      {
        fixture: "malformed list expectation fixture",
        message: "before fixture (edopro): Expected absentLegalActionGroups has malformed value null",
      },
      {
        fixture: "malformed list expectation fixture",
        message: "before fixture (edopro): Expected logIncludes has malformed value [object Object]",
      },
      {
        fixture: "malformed list expectation fixture",
        message: "before fixture (edopro): Expected attackedTargetUids has malformed value 7",
      },
      {
        fixture: "malformed list expectation fixture",
        message: "before fixture (edopro): Expected battlePairs has malformed value attack",
      },
    ]);
  });

  it("rejects malformed battle pair expectation entries by index", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed battle pair entry fixture",
      options: { seed: 66, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        battlePairs: [null as never],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed battle pair entry fixture",
        message: "before fixture (edopro): Expected battlePairs[0] has malformed value null",
      },
    ]);
  });
});
